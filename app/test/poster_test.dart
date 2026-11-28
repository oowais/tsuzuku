import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/server/server_config.dart';
import 'package:tsuzuku/up_next/poster.dart';

/// Every poster URL answers 404, as Trakt's missing season posters do.
class _MissingPosters extends Fake implements BaseCacheManager {
  final requested = <String>[];

  @override
  Stream<FileResponse> getFileStream(
    String url, {
    String? key,
    Map<String, String>? headers,
    bool withProgress = false,
  }) {
    requested.add(url);
    return Stream.error(
      HttpExceptionWithStatus(404, 'missing', uri: Uri.parse(url)),
    );
  }
}

void main() {
  tearDown(() {
    Poster.cacheManager = null;
    Poster.failed.clear();
  });

  // #110: cards sharing a poster URL share one load. When it fails, every one of them, not only the
  // first to see the failure, moves on to the next image.
  testWidgets('cards sharing a failed poster all move on to the next image', (
    tester,
  ) async {
    final cache = _MissingPosters();
    Poster.cacheManager = cache;
    const source = PosterSource(ServerConfig(baseUrl: 'https://t.example'));
    const images = [
      'https://img.example/season.webp',
      'https://img.example/show.webp',
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: ListView(
          children: [
            for (var i = 0; i < 4; i++)
              const Poster(
                images: images,
                source: source,
                width: 80,
                height: 120,
              ),
          ],
        ),
      ),
    );
    for (var i = 0; i < 10; i++) {
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
    }
    // One request per URL, not per card; then every card has given up on both.
    expect(cache.requested, images);
    expect(Poster.failed, images.toSet());
    expect(find.byType(CachedNetworkImage), findsNothing);
  });
}
