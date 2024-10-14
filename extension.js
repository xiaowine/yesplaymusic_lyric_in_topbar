const Soup = imports.gi.Soup;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Notification = imports.ui.messageTray.Notification;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
let box, label, musicPlayer;

class HttpClient {
    constructor() {
        this._session = new Soup.Session();
    }

    makeRequest(url) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new("GET", url);
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const response = session.send_and_read_finish(result);
                    resolve(JSON.parse(response.get_data().toString()));
                } catch (e) {
                    reject(`HTTP request to ${url} failed: ${e.message}`);
                }
            });
        });
    }
}

class Notifier {
    static showNotification(title, message, timeout) {
        const source = new MessageTray.Source(Me.metadata.name, "dialog-information");
        Main.messageTray.add(source);
        const notification = new MessageTray.Notification(source, title, message);
        notification.setTransient(true);
        source.showNotification(notification);
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
            source.destroy();
            return GLib.SOURCE_REMOVE;
        });
    }
}

class LyricsProcessor {
    static parseLyrics(songLyrics, songProgress) {
        const lyrics = songLyrics.match(/\[(\d+):(\d+\.\d+)](.*)/g) || [];
        let currentLyric = "";
        for (const lyric of lyrics) {
            const [_, minute, second, text] = lyric.match(/\[(\d+):(\d+\.\d+)](.*)/);
            if (parseInt(minute) * 60 + parseFloat(second) <= songProgress) {
                currentLyric = text;
            } else {
                break;
            }
        }
        return currentLyric;
    }
}

class MusicPlayer {
    constructor() {
        this.songName = "";
        this.songLyric = "";
        this.songProgress = 0;
        this.isPlaying = false;
        this.httpClient = new HttpClient();
        this.bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        this.settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.ylyb");
        this.settings.connect("changed::time-interval", () => this.updateInterval());
        this.updateInterval();
        this.subscribeToMPRIS();
    }

    updateInterval() {
        this.timeInterval = this.settings.get_int("time-interval");
        if (this.isPlaying) {
            this.stop(); // Stop the current timer
            this.start(); // Restart with the new interval
        }
    }

    subscribeToMPRIS() {
        this.bus.call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "AddMatch",
            new GLib.Variant("(s)", [
                "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'",
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                    this.bus.signal_subscribe(
                        null,
                        "org.freedesktop.DBus.Properties",
                        "PropertiesChanged",
                        null,
                        null,
                        Gio.DBusSignalFlags.NONE,
                        this.handleMPRISChange.bind(this)
                    );
                } catch (e) {
                    log(`Failed to subscribe to MPRIS signals: ${e.message}`);
                }
            }
        );
    }

    handleMPRISChange(bus, sender, objectPath, interfaceName, signalName, parameters) {
        const [iface, changedProps] = parameters.deep_unpack();
        if (iface === "org.mpris.MediaPlayer2.Player") {
            const playbackStatus = changedProps["PlaybackStatus"]?.deep_unpack();
            this.isPlaying = playbackStatus === "Playing";
            if (this.isPlaying) {
                this.start();
            } else {
                this.stop();
            }
        }
    }

    async fetchSongInfo() {
        try {
            const player = await this.httpClient.makeRequest("http://127.0.0.1:27232/player");
            return {
                name: player.currentTrack.name,
                progress: player.progress,
                id: player.currentTrack.id,
            };
        } catch (error) {
            throw new Error(`Failed to fetch song info: ${error}`);
        }
    }

    async fetchLyrics(songId) {
        try {
            const lyrics = await this.httpClient.makeRequest(`http://127.0.0.1:10754/lyric?id=${songId}`);
            return lyrics.lrc.lyric;
        } catch (error) {
            throw new Error(`Failed to fetch song lyrics: ${error}`);
        }
    }

    async updateSongInfo() {
        try {
            const {name, progress, id} = await this.fetchSongInfo();
            if (progress !== this.songProgress) {
                this.songProgress = progress;
                this.songName = name;
                const lyrics = await this.fetchLyrics(id);
                this.songLyric = LyricsProcessor.parseLyrics(lyrics, progress);
                label.set_text(`${this.songName} - ${this.songLyric}`);
            }
        } catch (error) {
            this.stop();
        }
    }

    start() {
        box.show();
        this.updateSongInfo(); // Initial update
        this.intervalId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.timeInterval, () => {
            if (this.isPlaying) {
                this.updateSongInfo();
                return GLib.SOURCE_CONTINUE;
            } else {
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    stop() {
        this.isPlaying = false;
        this.songLyric = "";
        box.hide();
        if (this.intervalId) {
            GLib.source_remove(this.intervalId);
            this.intervalId = null;
        }
    }
}

function init() {
    // No object creation here, only static resources initialization
}

function enable() {
    musicPlayer = new MusicPlayer();
    box = new St.BoxLayout({reactive: true});
    label = new St.Label({y_expand: true, y_align: Clutter.ActorAlign.CENTER});
    box.add(label);
    Main.panel._centerBox.add(box);
    musicPlayer.start();
    box.connect("button-press-event", () => {
        try {
            GLib.spawn_command_line_async("yesplaymusic");
        } catch (error) {
            log(`Error opening yesplaymusic: ${error.message}`);
        }
    });
}

function disable() {
    if (box) {
        Main.panel._centerBox.remove_child(box);
        box = null;
    }
    if (musicPlayer) {
        musicPlayer.stop();
        musicPlayer = null;
    }
    if (label) {
        label = null;
    }
}
