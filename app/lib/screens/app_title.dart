import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/solid_glass.dart';
import '../up_next/format.dart' show maxContentWidth;
import '../update/update_controller.dart';
import 'update_widgets.dart' show SettingsIcon;

/// A tab's app bar title: the logo (the forward glass tile with 続), "Tsuzuku", then the screen's name, muted.
class AppTitle extends StatelessWidget {
  const AppTitle(this.screen, {super.key});

  final String screen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final g = Glass.of(context);
    final dark = theme.brightness == Brightness.dark;
    final base = theme.appBarTheme.titleTextStyle ?? theme.textTheme.titleLarge;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Image.asset(
          dark ? 'assets/icon/logo.png' : 'assets/icon/logo-light.png',
          width: 26,
          height: 26,
          filterQuality: FilterQuality.medium,
          semanticLabel: 'Tsuzuku',
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Tsuzuku',
                  style: base?.copyWith(fontWeight: FontWeight.w600),
                ),
                TextSpan(
                  text: '  /  ',
                  style: base?.copyWith(
                    color: g.textDimmed,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                TextSpan(
                  text: screen,
                  style: base?.copyWith(
                    color: g.textMuted,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// A tab's app bar, lined up with its content: on a screen wider than [maxContentWidth] the title starts and the
/// actions end where the centred content column does (legacy's container), not at the window's edges. The title is
/// always on the left (the theme turns off Flutter's centring on macOS and iOS).
AppBar tabAppBar(
  BuildContext context, {
  required Widget title,
  List<Widget>? actions,
}) {
  final extra = (MediaQuery.sizeOf(context).width - maxContentWidth) / 2;
  return AppBar(
    title: title,
    titleSpacing: math.max(NavigationToolbar.kMiddleSpacing, extra),
    // An icon button's glyph sits 8 px inside it.
    actionsPadding: EdgeInsets.only(right: math.max(0, extra - 8)),
    actions: [
      ...?actions,
      if (SettingsAction.maybeOf(context) case final settings?)
        IconButton(
          key: const ValueKey('open-settings'),
          onPressed: settings.onOpen,
          icon: SettingsIcon(updates: settings.updates),
          tooltip: 'Settings',
        ),
    ],
  );
}

/// Puts the Settings button (with the update dot) last in every tab's app bar, after Refresh. `HomeScreen` provides
/// it; Settings itself opens as its own page, outside it, so its app bar has no such button.
class SettingsAction extends InheritedWidget {
  const SettingsAction({
    super.key,
    required this.onOpen,
    this.updates,
    required super.child,
  });

  final VoidCallback onOpen;
  final UpdateController? updates;

  static SettingsAction? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<SettingsAction>();

  @override
  bool updateShouldNotify(SettingsAction old) =>
      onOpen != old.onOpen || updates != old.updates;
}
