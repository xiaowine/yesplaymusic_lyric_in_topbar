"use strict";

const { Gio, Gtk } = imports.gi;
const Gettext = imports.gettext;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
  ExtensionUtils.initTranslations(Me.metadata.uuid);
}

function buildPrefsWidget() {
  let schema = Me.metadata['settings-schema'];
  let settings = ExtensionUtils.getSettings(schema);

  let widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
  });

  let label = new Gtk.Label({
    label: "Set Time Interval (ms)",
    xalign: 0,
  });

  let adjustment = new Gtk.Adjustment({
    lower: 100,
    upper: 5000,
    step_increment: 100,
    page_increment: 100,
    page_size: 0,
  });

  let spinButton = new Gtk.SpinButton({
    adjustment: adjustment,
    digits: 0,
  });

  spinButton.set_value(settings.get_int("time-interval"));

  spinButton.connect("value-changed", (button) => {
    settings.set_int("time-interval", button.get_value_as_int());
  });

  let saveButton = new Gtk.Button({
    label: "Save",
  });

  saveButton.connect("clicked", () => {
    settings.set_int("time-interval", spinButton.get_value_as_int());
    print("Settings saved!");
  });

  widget.append(label);
  widget.append(spinButton);
  widget.append(saveButton);

  return widget;
}