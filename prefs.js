// SPDX-FileCopyrightText: 2020 Florian Müllner <fmuellner@gnome.org>
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class YlybThemePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // 创建一个偏好设置页面，包含一个组
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Settings'),
            description: _('Configure the settings of the extension'),
        });
        page.add(group);

        // 创建一个新的偏好设置行
        const intervalRow = new Adw.ActionRow({
            title: _('Set Time Interval (ms)'),
        });
        group.add(intervalRow);

        // 创建一个设置对象并绑定行到 `time-interval` 键
        this._settings = this.getSettings();

        const spinButton = this._createSpinButton();
        intervalRow.add_suffix(spinButton);
        intervalRow.activatable_widget = spinButton;

        // 创建 Logging Enabled 开关行
        const loggingRow = new Adw.ActionRow({
            title: _('Enable Logging'),
        });
        group.add(loggingRow);

        const loggingSwitch = this._createLoggingSwitch();
        loggingRow.add_suffix(loggingSwitch);
        loggingRow.activatable_widget = loggingSwitch;

        // 创建一个保存按钮
        const saveButton = new Gtk.Button({
            label: _('Save'),
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        saveButton.connect("clicked", () => {
            this._saveSettings(spinButton, loggingSwitch);
        });

        group.add(saveButton);
    }

    _createSpinButton() {
        const adjustment = new Gtk.Adjustment({
            lower: 100,
            upper: 5000,
            step_increment: 100,
            page_increment: 100,
            page_size: 0,
        });

        const spinButton = new Gtk.SpinButton({
            adjustment: adjustment,
            digits: 0,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        spinButton.set_value(this._settings.get_int("time-interval"));

        spinButton.connect("value-changed", (button) => {
            this._settings.set_int("time-interval", button.get_value_as_int());
        });

        return spinButton;
    }

    _createLoggingSwitch() {
        const switchButton = new Gtk.Switch({
            active: this._settings.get_boolean("logging-enabled"),
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        switchButton.connect("notify::active", (widget) => {
            this._settings.set_boolean("logging-enabled", widget.active);
        });

        return switchButton;
    }

    _saveSettings(spinButton, loggingSwitch) {
        try {
            this._settings.set_int("time-interval", spinButton.get_value_as_int());
            this._settings.set_boolean("logging-enabled", loggingSwitch.active);
            print("Settings saved!");
        } catch (error) {
            log(`Error saving settings: ${error.message}`);
        }
    }
}
