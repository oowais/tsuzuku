import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Light, dark or the device's own setting (legacy "Light or dark" in Settings), kept across restarts.
abstract interface class AppearanceStore {
  Future<String?> read();
  Future<void> write(String mode);
}

class PrefsAppearanceStore implements AppearanceStore {
  final _prefs = SharedPreferencesAsync();
  static const _key = 'theme_mode';

  @override
  Future<String?> read() => _prefs.getString(_key);

  @override
  Future<void> write(String mode) => _prefs.setString(_key, mode);
}

class MemoryAppearanceStore implements AppearanceStore {
  MemoryAppearanceStore([this.value]);

  String? value;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String mode) async => value = mode;
}

class AppearanceController extends ChangeNotifier {
  AppearanceController(this._store);

  final AppearanceStore _store;
  ThemeMode mode = ThemeMode.system;

  Future<void> load() async {
    try {
      mode = _parse(await _store.read());
    } catch (_) {
      // Unreadable storage: the device's setting.
      mode = ThemeMode.system;
    }
    notifyListeners();
  }

  Future<void> setMode(ThemeMode m) async {
    if (m == mode) return;
    mode = m;
    notifyListeners();
    await _store.write(m.name);
  }

  static ThemeMode _parse(String? s) => switch (s) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
}
