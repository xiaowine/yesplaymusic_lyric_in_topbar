class Settings {
    constructor(extension) {
      this.settings = extension.getSettings();
    }
  
    getTimeInterval() {
      return this.settings.get_int("time-interval");
    }
  
    isLoggingEnabled() {
      return this.settings.get_boolean("logging-enabled");
    }
  
    logMessage(message) {
      if (this.isLoggingEnabled()) {
        log(message);
      }
    }
  }export default Settings;