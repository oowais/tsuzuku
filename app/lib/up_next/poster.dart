import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../server/server_config.dart';

/// Turns the server's poster URLs into ones to load. Absolute URLs (source CDNs) load as they are,
/// without headers; relative ones (`/_demo/poster?...`) are on the Tsuzuku server and get its Access
/// headers, which never go to any other host.
class PosterSource {
  const PosterSource(this.config);

  final ServerConfig config;

  ({String url, Map<String, String>? headers})? resolve(String image) {
    final uri = Uri.tryParse(image);
    if (uri == null) return null;
    if (uri.hasScheme) {
      if (uri.scheme != 'https' && uri.scheme != 'http') return null;
      final server = Uri.tryParse(config.baseUrl);
      final own =
          server != null &&
          server.hasScheme &&
          server.scheme == uri.scheme &&
          server.host == uri.host &&
          server.port == uri.port;
      return (url: image, headers: own ? config.accessHeaders : null);
    }
    // Web: the page's own origin, with the browser's Access cookie.
    if (config.baseUrl.isEmpty) {
      return (url: Uri.base.resolveUri(uri).toString(), headers: null);
    }
    return (
      url: Uri.parse(config.baseUrl).resolveUri(uri).toString(),
      headers: config.accessHeaders.isEmpty ? null : config.accessHeaders,
    );
  }
}

/// A show's poster: the first of its images that loads, else an empty frame. Decoded at the size it
/// is shown, so long lists scroll smoothly.
class Poster extends StatefulWidget {
  const Poster({
    super.key,
    required this.images,
    required this.source,
    required this.width,
    required this.height,
  });

  final List<String> images;
  final PosterSource? source;
  final double width;
  final double height;

  /// URLs that failed this run, so a rebuilt card does not try them again.
  static final failed = <String>{};

  @override
  State<Poster> createState() => _PosterState();
}

class _PosterState extends State<Poster> {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final frame = Container(
      width: widget.width,
      height: widget.height,
      color: scheme.surfaceContainerHighest,
    );
    final source = widget.source;
    if (source == null) return _clip(frame);
    final candidate = widget.images
        .map(source.resolve)
        .whereType<({String url, Map<String, String>? headers})>()
        .where((r) => !Poster.failed.contains(r.url))
        .firstOrNull;
    if (candidate == null) return _clip(frame);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return _clip(
      CachedNetworkImage(
        key: ValueKey(candidate.url),
        imageUrl: candidate.url,
        httpHeaders: candidate.headers,
        width: widget.width,
        height: widget.height,
        fit: BoxFit.cover,
        memCacheWidth: (widget.width * dpr).round(),
        fadeInDuration: const Duration(milliseconds: 120),
        placeholder: (_, _) => frame,
        errorWidget: (_, url, _) {
          // Try the next image once this frame is done.
          if (Poster.failed.add(url)) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) setState(() {});
            });
          }
          return frame;
        },
      ),
    );
  }

  Widget _clip(Widget child) =>
      ClipRRect(borderRadius: BorderRadius.circular(8), child: child);
}
