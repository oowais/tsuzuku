import 'package:flutter/material.dart';

import '../theme/solid_glass.dart';

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
