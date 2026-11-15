import 'package:flutter/material.dart';

/// List-status and chart colours (legacy `--list-*`, `--chart-sequential` in `main.css`). Defaults are legacy's
/// default theme; each theme (#108, 3.6 Themes) sets its own through this extension.
@immutable
class StatusColors extends ThemeExtension<StatusColors> {
  const StatusColors({
    required this.watching,
    required this.completed,
    required this.hold,
    required this.dropped,
    required this.planToWatch,
    required this.chart,
  });

  static const light = StatusColors(
    watching: Color(0xFF2A78D6),
    completed: Color(0xFFEB6834),
    hold: Color(0xFF1BAF7A),
    dropped: Color(0xFFEDA100),
    planToWatch: Color(0xFFE87BA4),
    chart: Color(0xFF2A78D6),
  );

  static const dark = StatusColors(
    watching: Color(0xFF3987E5),
    completed: Color(0xFFD95926),
    hold: Color(0xFF199E70),
    dropped: Color(0xFFC98500),
    planToWatch: Color(0xFFD55181),
    chart: Color(0xFF3987E5),
  );

  final Color watching;
  final Color completed;
  final Color hold;
  final Color dropped;
  final Color planToWatch;

  /// One-hue charts (ratings, marks).
  final Color chart;

  /// The theme's, else legacy's default for its brightness.
  static StatusColors of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<StatusColors>() ??
        (theme.brightness == Brightness.dark ? dark : light);
  }

  /// A list status key from the API (watching, completed, hold, dropped, plantowatch).
  Color forKey(String key) => switch (key) {
    'watching' => watching,
    'completed' => completed,
    'hold' => hold,
    'dropped' => dropped,
    _ => planToWatch,
  };

  @override
  StatusColors copyWith({
    Color? watching,
    Color? completed,
    Color? hold,
    Color? dropped,
    Color? planToWatch,
    Color? chart,
  }) => StatusColors(
    watching: watching ?? this.watching,
    completed: completed ?? this.completed,
    hold: hold ?? this.hold,
    dropped: dropped ?? this.dropped,
    planToWatch: planToWatch ?? this.planToWatch,
    chart: chart ?? this.chart,
  );

  @override
  StatusColors lerp(StatusColors? other, double t) {
    if (other == null) return this;
    return StatusColors(
      watching: Color.lerp(watching, other.watching, t)!,
      completed: Color.lerp(completed, other.completed, t)!,
      hold: Color.lerp(hold, other.hold, t)!,
      dropped: Color.lerp(dropped, other.dropped, t)!,
      planToWatch: Color.lerp(planToWatch, other.planToWatch, t)!,
      chart: Color.lerp(chart, other.chart, t)!,
    );
  }
}
