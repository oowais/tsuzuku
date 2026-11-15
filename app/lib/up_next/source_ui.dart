import 'package:flutter/material.dart';
import 'package:simple_icons/simple_icons.dart';

// Each source's logo, shown next to its name everywhere, in its brand colour (legacy `SourceIcon`,
// `SourceName`). MAL's dark blue is lightened in dark mode; Simkl's brand is black, so it takes the
// text colour.

const sourceLabels = {
  'trakt': 'Trakt',
  'simkl': 'Simkl',
  'mal': 'MAL',
  'anilist': 'AniList',
  'tmdb': 'TMDB',
};

String sourceLabel(String source) => sourceLabels[source] ?? source;

IconData? sourceIconData(String source) => switch (source) {
  'trakt' => SimpleIcons.trakt,
  'simkl' => SimpleIcons.simkl,
  'mal' => SimpleIcons.myanimelist,
  'anilist' => SimpleIcons.anilist,
  'tmdb' => SimpleIcons.themoviedatabase,
  _ => null,
};

Color? sourceColor(String source, Brightness brightness) => switch (source) {
  'trakt' => const Color(0xFF9F42C6),
  'mal' =>
    brightness == Brightness.dark
        ? const Color(0xFF8DA6E8)
        : const Color(0xFF2E51A2),
  'anilist' => const Color(0xFF02A9FF),
  'tmdb' => const Color(0xFF01B4E4),
  _ => null,
};

/// A source's logo at text size.
class SourceIcon extends StatelessWidget {
  const SourceIcon(this.source, {super.key, this.size});

  final String source;
  final double? size;

  @override
  Widget build(BuildContext context) {
    final icon = sourceIconData(source);
    if (icon == null) return const SizedBox.shrink();
    final style = DefaultTextStyle.of(context).style;
    return Icon(
      icon,
      size: size ?? (style.fontSize ?? 14) * 1.1,
      color: sourceColor(source, Theme.of(context).brightness) ?? style.color,
      semanticLabel: sourceLabel(source),
    );
  }
}

/// A source's logo and name, e.g. Trakt with its logo.
class SourceName extends StatelessWidget {
  const SourceName(this.source, {super.key, this.style});

  final String source;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ExcludeSemantics(child: SourceIcon(source)),
      const SizedBox(width: 4),
      Text(sourceLabel(source), style: style),
    ],
  );
}

/// [SourceName] inside running text (`Text.rich`), on the text baseline.
InlineSpan sourceSpan(String source, {TextStyle? style}) => WidgetSpan(
  alignment: PlaceholderAlignment.middle,
  child: SourceName(source, style: style),
);
