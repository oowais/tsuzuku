/// The pure part of the in-app update (#108, step 3.3), ported from Befikr's `useUpdate.ts`: which
/// GitHub release counts, which file this platform updates from, and when to check again.
library;

/// The GitHub repository the app's releases come from.
const releasesUrl =
    'https://api.github.com/repos/oowais/tsuzuku/releases?per_page=30';

/// At most one check a day, unless the user asks.
const checkInterval = Duration(days: 1);

/// A newer release whose file for this platform is not attached yet ("being built").
const pendingRecheck = Duration(minutes: 5);

/// The platforms the app updates on. Web has none: the server serves it.
enum UpdatePlatform { android, windows, linux }

/// The Release file each platform updates from (fixed names, `.github/workflows/app-release.yml`).
String assetName(UpdatePlatform platform) => switch (platform) {
  UpdatePlatform.android => 'tsuzuku.apk',
  UpdatePlatform.windows => 'tsuzuku-setup.exe',
  UpdatePlatform.linux => 'tsuzuku-x86_64.AppImage',
};

/// An `X.Y.Z` version.
class Version implements Comparable<Version> {
  const Version(this.major, this.minor, this.patch);

  final int major, minor, patch;

  static final _pattern = RegExp(r'^(\d+)\.(\d+)\.(\d+)$');

  /// `0.2.1`, also `0.2.1+5` (the build number is ignored); null when it isn't one.
  static Version? tryParse(String text) {
    final m = _pattern.firstMatch(text.split('+').first.trim());
    if (m == null) return null;
    return Version(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
  }

  /// The version of an app release tag `app-vX.Y.Z`; null for any other tag (backend releases).
  static Version? fromTag(String tag) =>
      tag.startsWith('app-v') ? tryParse(tag.substring(5)) : null;

  @override
  int compareTo(Version other) => major != other.major
      ? major.compareTo(other.major)
      : minor != other.minor
      ? minor.compareTo(other.minor)
      : patch.compareTo(other.patch);

  bool operator >(Version other) => compareTo(other) > 0;

  @override
  bool operator ==(Object other) => other is Version && compareTo(other) == 0;

  @override
  int get hashCode => Object.hash(major, minor, patch);

  @override
  String toString() => '$major.$minor.$patch';
}

/// The result of a check, kept across restarts.
class LatestRelease {
  const LatestRelease({
    required this.version,
    required this.ready,
    required this.checkedAt,
    this.assetUrl,
    this.signatureUrl,
  });

  final Version version;

  /// This platform's file is attached to the release.
  final bool ready;

  /// Download URL of this platform's file, and of its `.sig` (desktop only).
  final String? assetUrl;
  final String? signatureUrl;

  final DateTime checkedAt;

  Map<String, Object?> toJson() => {
    'version': '$version',
    'ready': ready,
    'assetUrl': assetUrl,
    'signatureUrl': signatureUrl,
    'checkedAt': checkedAt.toUtc().toIso8601String(),
  };

  /// Null for anything that isn't a saved check (an older or broken value).
  static LatestRelease? fromJson(Object? json) {
    if (json is! Map) return null;
    final version = Version.tryParse('${json['version']}');
    final checkedAt = DateTime.tryParse('${json['checkedAt']}');
    final ready = json['ready'];
    if (version == null || checkedAt == null || ready is! bool) return null;
    return LatestRelease(
      version: version,
      ready: ready,
      assetUrl: json['assetUrl'] as String?,
      signatureUrl: json['signatureUrl'] as String?,
      checkedAt: checkedAt,
    );
  }
}

/// The newest app release in a GitHub `/releases` answer: tag `app-vX.Y.Z`, published, not a
/// pre-release. Other tags (backend releases) never count. Null when there is none.
LatestRelease? newestAppRelease(
  List<Object?> releases,
  UpdatePlatform platform,
  DateTime now,
) {
  Map? best;
  Version? bestVersion;
  for (final r in releases) {
    if (r is! Map) continue;
    if (r['draft'] == true || r['prerelease'] == true) continue;
    final v = Version.fromTag('${r['tag_name']}');
    if (v == null) continue;
    if (bestVersion == null || v > bestVersion) {
      best = r;
      bestVersion = v;
    }
  }
  if (best == null || bestVersion == null) return null;
  final assets = (best['assets'] as List? ?? const []).whereType<Map>().where(
    (a) => a['state'] == null || a['state'] == 'uploaded',
  );
  String? url(String name) {
    for (final a in assets) {
      if (a['name'] == name) return a['browser_download_url'] as String?;
    }
    return null;
  }

  final name = assetName(platform);
  final asset = url(name);
  final signature = platform == UpdatePlatform.android
      ? null
      : url('$name.sig');
  return LatestRelease(
    version: bestVersion,
    // Desktop files count only with their signature next to them.
    ready:
        asset != null &&
        (platform == UpdatePlatform.android || signature != null),
    assetUrl: asset,
    signatureUrl: signature,
    checkedAt: now,
  );
}

/// Whether an automatic check is due: none saved yet, a day since the last one, or five minutes
/// while a newer release still waits for this platform's file.
bool checkDue(LatestRelease? saved, Version? current, DateTime now) {
  if (saved == null) return true;
  final building = current != null && saved.version > current && !saved.ready;
  final since = now.difference(saved.checkedAt);
  // A clock set back makes the saved check look like it is from the future: check again.
  if (since.isNegative) return true;
  return since >= (building ? pendingRecheck : checkInterval);
}
