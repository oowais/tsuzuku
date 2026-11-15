import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'screens/access_rejected_screen.dart';
import 'screens/home_screen.dart';
import 'screens/server_form.dart';
import 'server/server_config.dart';
import 'settings/appearance.dart';
import 'update/update_controller.dart';

void main() {
  // Secure storage talks to the platform, which needs the binding before runApp.
  WidgetsFlutterBinding.ensureInitialized();
  final controller = AppController(
    store: devServerUrl.isNotEmpty
        ? DevServerConfigStore(devServerUrl)
        : SecureServerConfigStore(),
  )..load();
  final updates = UpdateController(
    platform: currentUpdatePlatform(),
    store: PrefsUpdateStore(),
  )..start();
  final appearance = AppearanceController(PrefsAppearanceStore())..load();
  runApp(
    TsuzukuApp(
      controller: controller,
      updates: updates,
      appearance: appearance,
    ),
  );
}

class TsuzukuApp extends StatelessWidget {
  const TsuzukuApp({
    super.key,
    required this.controller,
    this.updates,
    this.appearance,
  });

  final AppController controller;

  /// Light, dark or system; null in tests that don't cover it (system).
  final AppearanceController? appearance;

  /// In-app updates; null in tests that don't cover them.
  final UpdateController? updates;

  static const _seed = Color(0xFF16A34A);

  @override
  Widget build(BuildContext context) {
    final a = appearance;
    if (a == null) return _app(ThemeMode.system);
    return ListenableBuilder(
      listenable: a,
      builder: (context, _) => _app(a.mode),
    );
  }

  Widget _app(ThemeMode mode) {
    return MaterialApp(
      title: 'Tsuzuku',
      themeMode: mode,
      theme: ThemeData(colorSchemeSeed: _seed, brightness: Brightness.light),
      darkTheme: ThemeData(colorSchemeSeed: _seed, brightness: Brightness.dark),
      home: ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          if (controller.loading) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          if (controller.needsSetup) {
            return FirstRunScreen(controller: controller);
          }
          if (controller.accessRejected) {
            return AccessRejectedScreen(controller: controller);
          }
          return HomeScreen(
            controller: controller,
            updates: updates,
            appearance: appearance,
          );
        },
      ),
    );
  }
}
