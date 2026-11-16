import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'status_colors.dart';

// Solid Glass (#108, step 3.6), the app's only theme: legacy's `solid-glass` (main.css, after deeplethe/solid-glass,
// MIT), ported as it is, light and dark. Values are legacy's oklch tokens converted to sRGB. Its rules:
// 1. The finish is at the edge: a line of light along the top (rim), a fainter one inside it, a hairline round it and
//    a narrow shadow pulled downward. Never a gradient across the face, never a glow.
// 2. Heavy, not airy: neutral grey.
// 3. Depth is thickness: cards (thinner, more see-through) < the floating layer (sheets, dialogs, menus, nav bar).
// 4. One state: chosen and held open are the same small pane of clear glass (the nav bar's current tab).
// The interface has no colour of its own: the accent is the ink (near black in light, near white in dark) and the
// primary button is a solid pane of it. Hue is kept for meaning (success, warning, error, info). Light mode has three
// faint lights under the page. Screens take every colour from here (or `Theme.of(context).colorScheme`).

/// The tokens Material has no slot for.
@immutable
class Glass extends ThemeExtension<Glass> {
  const Glass({
    required this.bg,
    required this.bgMuted,
    required this.bgElevated,
    required this.bgAccented,
    required this.text,
    required this.textDimmed,
    required this.textMuted,
    required this.textToned,
    required this.textHighlighted,
    required this.textInverted,
    required this.border,
    required this.borderMuted,
    required this.borderAccented,
    required this.success,
    required this.warning,
    required this.info,
    required this.lights,
    required this.card,
    required this.popover,
    required this.rim,
    required this.inner,
    required this.edge,
    required this.shade,
    required this.contact,
    required this.lift,
    required this.state,
    required this.stateRim,
    required this.stateEdge,
    required this.primarySolid,
    required this.primaryRim,
    required this.primaryUnder,
    required this.primaryInner,
    required this.blurSigma,
  });

  static const light = Glass(
    bg: Color(0xFFE4E6EB),
    bgMuted: Color(0xFFEDEEF2),
    bgElevated: Color(0xFFF5F7FA),
    bgAccented: Color(0xFFD6D9E0),
    text: Color(0xFF161616),
    textDimmed: Color(0xFF747474),
    textMuted: Color(0xFF5B5B5B),
    textToned: Color(0xFF2E2E2E),
    textHighlighted: Color(0xFF0D0D0D),
    textInverted: Color(0xFFFAFAFA),
    border: Color(0x21292E38),
    borderMuted: Color(0x17292E38),
    borderAccented: Color(0x33292E38),
    success: Color(0xFF0A924B),
    warning: Color(0xFFD87400),
    info: Color(0xFF0078CC),
    lights: [Color(0x122EB184), Color(0x1C7FB5DC), Color(0x0A2EB184)],
    card: Color(0x99F7F8FB),
    popover: Color(0xF5F9FAFC),
    rim: Color(0xE6FFFFFF),
    inner: Color(0x59FFFFFF),
    edge: Color(0x1A3B4253),
    shade: Color(0x471F2D4C),
    contact: Color(0x0F1B2130),
    lift: Color(0x241B2130),
    state: Color(0x17292E38),
    stateRim: Color(0xD9FFFFFF),
    stateEdge: Color(0x21292E38),
    primarySolid: 0.88,
    primaryRim: Color(0x4CFFFFFF),
    primaryUnder: Color(0x73000000),
    primaryInner: Color(0x12FFFFFF),
    blurSigma: 13,
  );

  static const dark = Glass(
    bg: Color(0xFF0D0D0D),
    bgMuted: Color(0xFF141414),
    bgElevated: Color(0xFF1B1B1B),
    bgAccented: Color(0xFF262626),
    text: Color(0xFFE8E8E8),
    textDimmed: Color(0xFF7A7A7A),
    textMuted: Color(0xFFA4A4A4),
    textToned: Color(0xFFD1D1D1),
    textHighlighted: Color(0xFFFAFAFA),
    textInverted: Color(0xFF121212),
    border: Color(0x1CFFFFFF),
    borderMuted: Color(0x14FFFFFF),
    borderAccented: Color(0x29FFFFFF),
    success: Color(0xFF4AC777),
    warning: Color(0xFFF79C40),
    info: Color(0xFF449DF0),
    lights: [],
    card: Color(0x75303030),
    popover: Color(0xF51B1B1B),
    rim: Color(0x29FFFFFF),
    inner: Color(0x0AFFFFFF),
    edge: Color(0x0FFFFFFF),
    shade: Color(0x99000000),
    contact: Color(0x1A000000),
    lift: Color(0x38000000),
    state: Color(0x12FFFFFF),
    stateRim: Color(0x1CFFFFFF),
    stateEdge: Color(0x0FFFFFFF),
    primarySolid: 0.86,
    primaryRim: Color(0xFFFFFFFF),
    primaryUnder: Color(0x38000000),
    primaryInner: Color(0x12000000),
    blurSigma: 13,
  );

  // Page and text.
  final Color bg;
  final Color bgMuted;
  final Color bgElevated;
  final Color bgAccented;
  final Color text;
  final Color textDimmed;
  final Color textMuted;
  final Color textToned;
  final Color textHighlighted;
  final Color textInverted;
  final Color border;
  final Color borderMuted;
  final Color borderAccented;

  /// Hue only for meaning.
  final Color success;
  final Color warning;
  final Color info;

  /// The three faint lights under the page (light mode; none in dark).
  final List<Color> lights;

  // The panes.
  /// A card's smoky face.
  final Color card;

  /// The floating layer's face (sheets, dialogs, menus, nav bar).
  final Color popover;

  /// The line of light along a pane's top edge.
  final Color rim;

  /// The fainter hairline inside a card's edge.
  final Color inner;

  /// The hairline round a pane.
  final Color edge;

  /// The narrow shadow pulled downward.
  final Color shade;
  final Color contact;
  final Color lift;

  /// The one state: a small pane of clear glass.
  final Color state;
  final Color stateRim;
  final Color stateEdge;

  /// The primary button: a solid pane of the ink at this opacity, lit along its top, shaded along its bottom.
  final double primarySolid;
  final Color primaryRim;
  final Color primaryUnder;
  final Color primaryInner;

  /// Backdrop blur of the floating layer (legacy `blur(26px)`: CSS radius 26 is about sigma 13).
  final double blurSigma;

  /// Legacy `--ui-radius` (0.4375rem); cards and panes use twice it.
  static const radius = 7.0;
  static const paneRadius = 14.0;
  static const controlRadius = 10.5;

  static Glass of(BuildContext context) =>
      Theme.of(context).extension<Glass>() ??
      (Theme.of(context).brightness == Brightness.dark ? dark : light);

  /// A card's outer shadows: contact and the shade pulled down.
  List<BoxShadow> get cardShadows => [
    BoxShadow(color: contact, offset: const Offset(0, 1), blurRadius: 2),
    BoxShadow(
      color: shade,
      offset: const Offset(0, 12),
      blurRadius: 32,
      spreadRadius: -14,
    ),
  ];

  /// The floating layer's: lifted further off the page.
  List<BoxShadow> get floatShadows => [
    BoxShadow(
      color: shade,
      offset: const Offset(0, 24),
      blurRadius: 60,
      spreadRadius: -18,
    ),
    BoxShadow(
      color: lift,
      offset: const Offset(0, 6),
      blurRadius: 16,
      spreadRadius: -6,
    ),
  ];

  /// A card's edges.
  PaneBorder cardBorder([double radius = paneRadius]) =>
      PaneBorder(radius: radius, rim: rim, inner: inner, edge: edge);

  /// The floating layer's edges: rim and hairline, no inner line.
  PaneBorder floatBorder(BorderRadius radius) =>
      PaneBorder.radii(radius, rim: rim, edge: edge);

  /// The one state's edges.
  PaneBorder stateBorder([double radius = controlRadius]) =>
      PaneBorder(radius: radius, rim: stateRim, edge: stateEdge);

  @override
  Glass copyWith() => this;

  @override
  Glass lerp(Glass? other, double t) => other == null || t < 0.5 ? this : other;
}

/// A pane's edges, painted over its face: a hairline round it ([edge]), a fainter one inside ([inner]) and a line of
/// light along the top ([rim], legacy `inset 0 1px 0`).
class PaneBorder extends OutlinedBorder {
  PaneBorder({
    double radius = Glass.paneRadius,
    required this.rim,
    required this.edge,
    this.inner,
    this.edgeWidth = 1,
  }) : borderRadius = BorderRadius.circular(radius);

  const PaneBorder.radii(
    this.borderRadius, {
    required this.rim,
    required this.edge,
    this.inner,
    this.edgeWidth = 1,
  });

  final BorderRadius borderRadius;

  /// Wider where the edge says something (a card whose sources differ).
  final double edgeWidth;
  final Color rim;
  final Color edge;
  final Color? inner;

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRRect(borderRadius.toRRect(rect));

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRRect(borderRadius.toRRect(rect));

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    final rrect = borderRadius.toRRect(rect);
    // The rim: what the pane loses when shifted down by 1 px, inside its outline.
    canvas.save();
    canvas.clipRRect(rrect);
    final rimPath = Path.combine(
      PathOperation.difference,
      Path()..addRRect(rrect),
      Path()..addRRect(rrect.shift(const Offset(0, 1))),
    );
    canvas.drawPath(rimPath, Paint()..color = rim);
    if (inner != null) {
      canvas.drawRRect(
        rrect.deflate(1.5),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = inner!,
      );
    }
    canvas.restore();
    canvas.drawRRect(
      rrect.deflate(edgeWidth / 2),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = edgeWidth
        ..color = edge,
    );
  }

  @override
  ShapeBorder scale(double t) =>
      PaneBorder.radii(borderRadius * t, rim: rim, edge: edge, inner: inner);

  @override
  OutlinedBorder copyWith({BorderSide? side}) => this;

  @override
  bool operator ==(Object other) =>
      other is PaneBorder &&
      other.borderRadius == borderRadius &&
      other.rim == rim &&
      other.edge == edge &&
      other.inner == inner &&
      other.edgeWidth == edgeWidth;

  @override
  int get hashCode => Object.hash(borderRadius, rim, edge, inner, edgeWidth);
}

/// A content card: a pane of the card thickness, with its outer shadow. [edgeColor] replaces the hairline where the
/// edge says something (a card whose sources differ).
class PaneCard extends StatelessWidget {
  const PaneCard({
    super.key,
    required this.child,
    this.radius = Glass.paneRadius,
    this.edgeColor,
    this.edgeWidth = 1,
    this.padding,
    this.onTap,
  });

  final Widget child;
  final double radius;
  final Color? edgeColor;
  final double edgeWidth;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final g = Glass.of(context);
    final border = PaneBorder(
      radius: radius,
      rim: g.rim,
      inner: g.inner,
      edge: edgeColor ?? g.edge,
      edgeWidth: edgeWidth,
    );
    Widget content = padding == null
        ? child
        : Padding(padding: padding!, child: child);
    if (onTap != null) {
      content = InkWell(
        onTap: onTap,
        splashFactory: NoSplash.splashFactory,
        highlightColor: Colors.transparent,
        child: content,
      );
    }
    return CustomPaint(
      painter: OuterShadows(BorderRadius.circular(radius), g.cardShadows),
      child: Material(
        color: g.card,
        shape: border,
        clipBehavior: Clip.antiAlias,
        child: content,
      ),
    );
  }
}

/// The floating layer's pane: the thickest glass, blurring what is behind it.
class FloatPane extends StatelessWidget {
  const FloatPane({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(
      Radius.circular(Glass.paneRadius),
    ),
    this.blur = true,
  });

  final Widget child;
  final BorderRadius borderRadius;
  final bool blur;

  @override
  Widget build(BuildContext context) {
    final g = Glass.of(context);
    Widget face = Material(
      color: g.popover,
      shape: g.floatBorder(borderRadius),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
    if (blur) {
      face = ClipRRect(
        borderRadius: borderRadius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: g.blurSigma, sigmaY: g.blurSigma),
          child: face,
        ),
      );
    }
    return CustomPaint(
      painter: OuterShadows(borderRadius, g.floatShadows),
      child: face,
    );
  }
}

/// Shadows drawn only outside a pane, as CSS draws `box-shadow`: the panes are see-through, so a shadow under the
/// face would show through it.
class OuterShadows extends CustomPainter {
  OuterShadows(this.borderRadius, this.shadows);

  final BorderRadius borderRadius;
  final List<BoxShadow> shadows;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = borderRadius.toRRect(Offset.zero & size);
    canvas.save();
    canvas.clipPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect((Offset.zero & size).inflate(200)),
        Path()..addRRect(rrect),
      ),
    );
    for (final s in shadows) {
      canvas.drawRRect(
        rrect.shift(s.offset).inflate(s.spreadRadius),
        s.toPaint(),
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(OuterShadows old) =>
      old.borderRadius != borderRadius || old.shadows != shadows;
}

/// The page under everything: its colour and, in light mode, the three faint lights (legacy `body`'s radial
/// gradients, fixed to the window).
class GlassPage extends StatelessWidget {
  const GlassPage({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final g = Glass.of(context);
    return CustomPaint(painter: _LightsPainter(g), child: child);
  }
}

class _LightsPainter extends CustomPainter {
  _LightsPainter(this.g);

  final Glass g;
  static const _rem = 16.0;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = g.bg);
    if (g.lights.length < 3) return;
    // (radius x, radius y, centre x as a share of the width, centre y, colour, stop)
    final lights = [
      (62 * _rem, 42 * _rem, 0.12, -6 * _rem, g.lights[0], 0.62),
      (52 * _rem, 38 * _rem, 0.92, 4 * _rem, g.lights[1], 0.60),
      (64 * _rem, 46 * _rem, 0.55, size.height * 1.10, g.lights[2], 0.62),
    ];
    for (final (rx, ry, cx, cy, color, stop) in lights) {
      canvas.save();
      canvas.clipRect(Offset.zero & size);
      canvas.translate(size.width * cx, cy);
      canvas.scale(1, ry / rx);
      canvas.drawCircle(
        Offset.zero,
        rx,
        Paint()
          ..shader = RadialGradient(
            colors: [color, color.withValues(alpha: 0)],
            stops: [0, stop],
          ).createShader(Rect.fromCircle(center: Offset.zero, radius: rx)),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_LightsPainter old) => old.g != g;
}

/// The primary button's face: a solid pane of the ink, lit along its top edge, shaded along its bottom one.
Widget inkPaneBackground(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) {
  final g = Glass.of(context);
  if (states.contains(WidgetState.disabled)) return child ?? const SizedBox();
  return CustomPaint(foregroundPainter: _InkPanePainter(g), child: child);
}

class _InkPanePainter extends CustomPainter {
  _InkPanePainter(this.g);

  final Glass g;

  @override
  void paint(Canvas canvas, Size size) {
    // A round button (as wide as tall) is a circle; the rest have the control radius.
    final round = (size.width - size.height).abs() < 1;
    final r = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(round ? size.height / 2 : Glass.controlRadius),
    );
    canvas.save();
    canvas.clipRRect(r);
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRRect(r),
        Path()..addRRect(r.shift(const Offset(0, 1))),
      ),
      Paint()..color = g.primaryRim,
    );
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRRect(r),
        Path()..addRRect(r.shift(const Offset(0, -1))),
      ),
      Paint()..color = g.primaryUnder,
    );
    canvas.drawRRect(
      r.deflate(0.5),
      Paint()
        ..style = PaintingStyle.stroke
        ..color = g.primaryInner,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_InkPanePainter old) => old.g != g;
}

/// A round icon button in the primary pane's look (legacy `bg-primary` buttons: Mark watched).
ButtonStyle inkPaneIconStyle(BuildContext context) {
  final g = Glass.of(context);
  final ink = Theme.of(context).colorScheme.primary;
  return IconButton.styleFrom(
    backgroundColor: ink.withValues(alpha: g.primarySolid),
    foregroundColor: g.textInverted,
    disabledBackgroundColor: g.state,
    disabledForegroundColor: g.textDimmed,
  ).copyWith(backgroundBuilder: inkPaneBackground);
}

/// The app's theme for a brightness.
ThemeData solidGlassTheme(Brightness brightness) {
  final g = brightness == Brightness.dark ? Glass.dark : Glass.light;
  final ink = brightness == Brightness.dark
      ? const Color(0xFFEBEBEB)
      : const Color(0xFF161616);
  final error = brightness == Brightness.dark
      ? const Color(0xFFFF6467)
      : const Color(0xFFE7000B);
  final scheme = ColorScheme(
    brightness: brightness,
    primary: ink,
    onPrimary: g.textInverted,
    primaryContainer: g.bgAccented,
    onPrimaryContainer: g.textHighlighted,
    secondary: ink,
    onSecondary: g.textInverted,
    secondaryContainer: g.state,
    onSecondaryContainer: g.textHighlighted,
    tertiary: ink,
    onTertiary: g.textInverted,
    error: error,
    onError: brightness == Brightness.dark ? g.textInverted : g.textInverted,
    errorContainer: error.withValues(alpha: 0.12),
    onErrorContainer: error,
    surface: g.bg,
    onSurface: g.text,
    onSurfaceVariant: g.textMuted,
    surfaceDim: g.bgMuted,
    surfaceBright: g.bgElevated,
    surfaceContainerLowest: g.bg,
    surfaceContainerLow: g.bgMuted,
    surfaceContainer: g.bgElevated,
    surfaceContainerHigh: g.bgElevated,
    surfaceContainerHighest: g.bgAccented,
    outline: g.borderAccented,
    outlineVariant: g.border,
    inverseSurface: brightness == Brightness.dark
        ? const Color(0xFFFAFAFA)
        : const Color(0xFF0D0D0D),
    onInverseSurface: g.textInverted,
    inversePrimary: g.textInverted,
    shadow: Colors.black,
    scrim: Colors.black,
    surfaceTint: Colors.transparent,
  );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Geist',
    brightness: brightness,
  );
  final text = base.textTheme.apply(
    bodyColor: g.text,
    displayColor: g.textHighlighted,
    fontFamily: 'Geist',
  );
  final control = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(Glass.controlRadius),
  );
  final popoverShape = g.floatBorder(BorderRadius.circular(Glass.paneRadius));
  return base.copyWith(
    textTheme: text,
    // The page and its lights are painted by `GlassPage` under every screen.
    scaffoldBackgroundColor: Colors.transparent,
    canvasColor: g.bg,
    dividerColor: g.border,
    extensions: [
      g,
      brightness == Brightness.dark ? StatusColors.dark : StatusColors.light,
    ],
    appBarTheme: AppBarTheme(
      // Titles on the left on every platform (Flutter centres them on macOS and iOS), as legacy's header.
      centerTitle: false,
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      foregroundColor: g.textHighlighted,
      titleTextStyle: text.titleLarge?.copyWith(
        color: g.textHighlighted,
        fontWeight: FontWeight.w600,
      ),
    ),
    cardTheme: CardThemeData(
      color: g.card,
      elevation: 0,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: g.cardBorder(),
    ),
    dividerTheme: DividerThemeData(color: g.border, space: 1, thickness: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.disabled)
              ? g.state
              : ink.withValues(
                  alpha: s.contains(WidgetState.hovered)
                      ? g.primarySolid - 0.10
                      : g.primarySolid,
                ),
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) =>
              s.contains(WidgetState.disabled) ? g.textDimmed : g.textInverted,
        ),
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
        elevation: const WidgetStatePropertyAll(0),
        shape: WidgetStatePropertyAll(control),
        backgroundBuilder: inkPaneBackground,
        textStyle: WidgetStatePropertyAll(
          text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: g.text,
        side: BorderSide(color: g.borderAccented),
        shape: control,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: g.textHighlighted,
        shape: control,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: g.textToned),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: g.popover,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      indicatorColor: g.state,
      indicatorShape: g.stateBorder(16),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(
          color: s.contains(WidgetState.selected)
              ? g.textHighlighted
              : g.textMuted,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => text.labelSmall?.copyWith(
          color: s.contains(WidgetState.selected)
              ? g.textHighlighted
              : g.textMuted,
          fontWeight: s.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w500,
        ),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: Colors.transparent,
      indicatorColor: g.state,
      indicatorShape: g.stateBorder(16),
      selectedIconTheme: IconThemeData(color: g.textHighlighted),
      unselectedIconTheme: IconThemeData(color: g.textMuted),
      selectedLabelTextStyle: text.labelSmall?.copyWith(
        color: g.textHighlighted,
        fontWeight: FontWeight.w600,
      ),
      unselectedLabelTextStyle: text.labelSmall?.copyWith(color: g.textMuted),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) =>
              s.contains(WidgetState.selected) ? g.state : Colors.transparent,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? g.textHighlighted
              : g.textMuted,
        ),
        side: WidgetStatePropertyAll(BorderSide(color: g.border)),
        overlayColor: WidgetStatePropertyAll(g.state),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.transparent,
      selectedColor: g.state,
      side: BorderSide(color: g.border),
      labelStyle: text.labelLarge?.copyWith(color: g.text),
      checkmarkColor: g.textHighlighted,
      shape: control,
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected)
            ? (s.contains(WidgetState.disabled) ? g.textDimmed : ink)
            : Colors.transparent,
      ),
      checkColor: WidgetStatePropertyAll(g.textInverted),
      side: BorderSide(color: g.borderAccented, width: 1.5),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Glass.controlRadius),
        borderSide: BorderSide(color: g.borderAccented),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Glass.controlRadius),
        borderSide: BorderSide(color: g.borderAccented),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Glass.controlRadius),
        borderSide: BorderSide(color: g.textHighlighted, width: 1.5),
      ),
      hintStyle: TextStyle(color: g.textDimmed),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: ink,
      linearTrackColor: g.state,
    ),
    // Sheets with no face of their own get the floating layer's (the app's own pass `Colors.transparent` and draw a
    // `FloatPane`, which also blurs and has the outer shadow).
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: g.popover,
      modalBackgroundColor: g.popover,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      modalElevation: 0,
      shape: g.floatBorder(
        const BorderRadius.vertical(top: Radius.circular(Glass.paneRadius + 6)),
      ),
      dragHandleColor: g.borderAccented,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: g.popover,
      surfaceTintColor: Colors.transparent,
      shape: popoverShape,
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: g.popover,
      surfaceTintColor: Colors.transparent,
      shape: popoverShape,
      elevation: 6,
      shadowColor: g.shade,
    ),
    menuTheme: MenuThemeData(
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(g.popover),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shape: WidgetStatePropertyAll(popoverShape),
      ),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: ShapeDecoration(color: g.popover, shape: popoverShape),
      textStyle: text.bodySmall?.copyWith(color: g.text),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: g.popover,
      contentTextStyle: text.bodyMedium?.copyWith(color: g.text),
      shape: popoverShape,
      behavior: SnackBarBehavior.floating,
      elevation: 6,
    ),
    bannerTheme: MaterialBannerThemeData(backgroundColor: g.bgElevated),
  );
}
