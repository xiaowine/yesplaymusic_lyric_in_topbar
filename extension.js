import Gio from 'gi://Gio';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import { Extension,  } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Settings from './settings.js';

class HttpClient {
  constructor(settings) {
    this._session = new Soup.Session();
    this.settings = settings;  // Store the settings reference
    this.settings.logMessage('HttpClient initialized');
  }

  makeRequest(url) {
    this.settings.logMessage(`Making request to URL: ${url}`);
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new("GET", url);
      this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
        (session, result) => {
          try {
            const response = session.send_and_read_finish(result);
            this.settings.logMessage(`Received response from URL: ${url}`);
            resolve(JSON.parse(response.get_data().toString()));
          } catch (e) {
            this.settings.logMessage(`Error making request to URL: ${url} - ${e.message}`);
            reject(e);
          }
        }
      );
    });
  }
}

class LyricsProcessor {
  constructor(settings) {
    this.settings = settings;  // Store the settings reference
  }

  parseLyrics(songLyrics, songProgress) {
    this.settings.logMessage(`Parsing lyrics at progress: ${songProgress}`);
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
    this.settings.logMessage(`Current lyric: ${currentLyric}`);
    return currentLyric;
  }
}



class MusicPlayer {
  constructor(settings) {
    this.songName = "";
    this.songLyric = "";
    this.songProgress = 0;
    this.isPlaying = false;
    this.settings = settings;  // Store settings reference
    this.httpClient = new HttpClient(settings);  // Pass settings to HttpClient
    this.lyricsProcessor = new LyricsProcessor(settings);  // Pass settings to LyricsProcessor
    this.bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    this.settings.settings.connect("changed::time-interval", () =>
      this.updateInterval()
    );
    this.updateInterval();
    this.subscribeToMPRIS();
    this.settings.logMessage('MusicPlayer initialized');
  }

  updateInterval() {
    this.timeInterval = this.settings.getTimeInterval();
    this.settings.logMessage(`Updated time interval: ${this.timeInterval}`);
    if (this.isPlaying) {
      this.stop(); // Stop the current timer
      this.start(); // Restart with the new interval
    }
  }

  subscribeToMPRIS() {
    this.settings.logMessage('Subscribing to MPRIS');
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
          this.settings.logMessage('Subscribed to MPRIS signals');
        } catch (e) {
          this.settings.logMessage(`Failed to subscribe to MPRIS signals: ${e.message}`);
        }
      }
    );
  }

  handleMPRISChange(bus, sender, objectPath, interfaceName, signalName, parameters) {
    const [iface, changedProps] = parameters.deep_unpack();
    if (iface === "org.mpris.MediaPlayer2.Player") {
      const playbackStatus = changedProps["PlaybackStatus"]?.deep_unpack();
      this.isPlaying = playbackStatus === "Playing";
      this.settings.logMessage(`Playback status changed: ${playbackStatus}`);
      if (this.isPlaying) {
        this.start();
      } else {
        this.stop();
      }
    }
  }

  async fetchSongInfo() {
    try {
      const player = await this.httpClient.makeRequest(
        "http://127.0.0.1:27232/player"
      );
      this.settings.logMessage(`Fetched song info: ${JSON.stringify(player)}`);
      return {
        name: player.currentTrack.name,
        progress: player.progress,
        id: player.currentTrack.id,
      };
    } catch (error) {
      this.settings.logMessage(`Failed to fetch song info: ${error.message}`);
      throw new Error(`Failed to fetch song info: ${error}`);
    }
  }

  async fetchLyrics(songId) {
    try {
      const lyrics = await this.httpClient.makeRequest(
        `http://127.0.0.1:10754/lyric?id=${songId}`
      );
      this.settings.logMessage(`Fetched lyrics for song ID ${songId}`);
      return lyrics.lrc.lyric;
    } catch (error) {
      this.settings.logMessage(`Failed to fetch song lyrics: ${error.message}`);
      throw new Error(`Failed to fetch song lyrics: ${error}`);
    }
  }

  async updateSongInfo() {
    this.settings.logMessage('Updating song info');
    try {
      const { name, progress, id } = await this.fetchSongInfo();
      if (progress !== this.songProgress) {
        this.songProgress = progress;
        this.songName = name;
        const lyrics = await this.fetchLyrics(id);
        this.songLyric = this.lyricsProcessor.parseLyrics(lyrics, progress); // Use lyricsProcessor instance
        this.label.set_text(`${this.songName} - ${this.songLyric}`);
        this.settings.logMessage(`Updated song info: ${this.songName} - ${this.songLyric}`);
      } else {
        this.settings.logMessage('Song progress has not changed');
      }
    } catch (error) {
      this.settings.logMessage(`Error updating song info: ${error.message}`);
      this.stop();
    }
  }

  start() {
    this.settings.logMessage('Starting music player');
    this.box.show();
    this.updateSongInfo(); // Initial update
    this.intervalId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this.timeInterval,  // timeInterval now in milliseconds
      () => {
        if (this.isPlaying) {
          this.updateSongInfo();
          return GLib.SOURCE_CONTINUE;  // Continue execution
        } else {
          return GLib.SOURCE_REMOVE;  // Stop the timer
        }
      }
    );
  }

  stop() {
    this.settings.logMessage('Stopping music player');
    this.isPlaying = false;
    this.songLyric = "";
    this.box.hide();
    if (this.intervalId) {
      GLib.source_remove(this.intervalId);
      this.intervalId = null;
    }
  }
}

export default class YlybExtension extends Extension {
  enable() {
    this.settings = new Settings(this);
    this.settings.logMessage('Enabling YlybExtension');
    this.musicPlayer = new MusicPlayer(this.settings);
    this.box = new St.BoxLayout({ reactive: true });
    this.label = new St.Label({ y_expand: true, y_align: 2 });
    this.box.add_child(this.label); // Use add_child method
    Main.panel._centerBox.add_child(this.box);
    this.musicPlayer.box = this.box; // Pass box to musicPlayer
    this.musicPlayer.label = this.label; // Pass label to musicPlayer
    this.musicPlayer.start();
    this.box.connect("button-press-event", () => {
      try {
        GLib.spawn_command_line_async("yesplaymusic");
        this.settings.logMessage('Opened yesplaymusic');
      } catch (error) {
        this.settings.logMessage(`Error opening yesplaymusic: ${error.message}`);
      }
    });
  }

  disable() {
    this.settings.logMessage('Disabling YlybExtension');
    if (this.box) {
      Main.panel._centerBox.remove_child(this.box);
      this.box = null;
    }
    this.musicPlayer.stop();
    this.settings = null;
  }
}
