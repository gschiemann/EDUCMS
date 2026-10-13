# Goodview Cloud player scaling evidence

Date: 2026-10-13. Read-only inspection of the two supplied APKs; neither was installed or executed. Decompiled under `/private/tmp/venueos-goodview-fit/` with apktool and jadx. APK SHA-256:

- `CloudSign-V3.1.8-GVBOX_97_20261010114828-release_saas.apk`: df298b738377fb164108bd3d56870f08b1deb5d0e16aef8a022d0f25e8f2f728
- `CloudSign-V3.1.8-RK3288_239_20260928084636-release_saas.apk`: 5284cb1147725f05faac0defc54481545581dff090a8bc0ed41ec37033d9e432

Both manifests identify package `com.wuhan.goodview.gtv_master`; the manifest launches `com.wuhan.goodview.gtv_master.activity.PlayActivity` as the playback activity. This is evidence about these two builds, not a claim about every Goodview generation.

## Direct findings

The playback root is a `FrameLayout` whose width and height are both `match_parent`. In both APKs, the relevant `view_video*.xml` playback layouts give the image view and GIF view `match_parent` dimensions and explicitly set `android:scaleType="fitXY"`. Example: `gvbox-java/resources/res/layout-port/view_video.xml` (likewise `layout-land/view_video.xml`, `view_video982.xml`, `view_video972.xml`, and hardware-specific `view_video3328.xml`). This is Android `FIT_XY`: scale each axis to the view bounds independently. It fills the playback region without letterboxing/cropping, and distorts aspect ratio when source and view ratios differ. The same `fitXY` declarations occur in the RK3288 APK's `layout-port/view_video.xml` and `view_video982.xml`.

The foreground video rendering surface is also `match_parent` in these layouts (`SurfaceView`, or `TextureView` on the `982` variant). Its view bounds therefore fill the parent. The Java media-player path in `com.wuhan.goodview.gtv_master.views.video.ViewFactory.K(String, SurfaceHolder, ImageView)` binds an Android `MediaPlayer` to a `SurfaceHolder` with `setDisplay(surfaceHolder)`; the inspected caller does not provide an aspect-ratio mode. There is a vendor `MMediaPlayer.setVideoDisplayAspectRatio(EnumVideoAspectRatio)` API with AUTO, 4:3, 16:9, pan-scan, letterbox, pillarbox and combined enum values, but I found no call from Goodview's app playback classes. Merely having this SDK API is not evidence that Goodview selects any one of those modes.

## What is and is not established

- **Image/GIF selected behavior:** explicit `fitXY` in playback resources. This is a real selected mode, not just an available option.
- **Video selected behavior:** playback surface fills the parent view; app Java binds a MediaPlayer to that surface. The application code examined does not select a vendor aspect mode. The native decoder/platform may still preserve video aspect inside that surface; this APK inspection alone does not establish whether video pixels are stretched, letterboxed, or cropped by the device decoder. Do not treat the image/GIF `fitXY` declaration as proof of video pixel behavior.
- **Editor behavior:** the supplied Goodview Cloud User Manual, PDF page 52 (printed page 51), says an image element can be resized proportionally in the program editor. That governs authoring an individual canvas element, not playback scaling of arbitrary source media.
- **Available vendor modes vs selected mode:** `MMediaPlayer.EnumVideoAspectRatio` exposes several native modes, but no app call site selecting them was found. The API surface is not proof those modes are configurable in this CloudSign UI or used as its playback default.

## Reproduction implication

The concrete Goodview behavior that the APK proves for raster images/GIFs is full playback-viewport fill with independent X/Y scaling (`fitXY`). That explains how those media can fill the entire screen with neither bars nor cropped edges, at the cost of aspect distortion. It is not evidence that Goodview uses a generalized `cover` or `contain` rule. For video, a hardware observation using a deliberately mismatched aspect-ratio clip (with visible content at all four edges and geometric circles) is still needed to resolve decoder behavior.

## Source locations

- Package/launch activity: `/private/tmp/venueos-goodview-fit/gvbox/AndroidManifest.xml` (package in root manifest; activity entry around line 76).
- Main image/GIF and surface layout: `/private/tmp/venueos-goodview-fit/gvbox-java/resources/res/layout-port/view_video.xml`.
- TextureView hardware variant: `/private/tmp/venueos-goodview-fit/gvbox-java/resources/res/layout-land/view_video982.xml` and matching portrait resource.
- Java surface binding: `/private/tmp/venueos-goodview-fit/gvbox-java/sources/com/wuhan/goodview/gtv_master/views/video/ViewFactory.java`, method `K(String, SurfaceHolder, ImageView)` near line 1342.
- Vendor aspect API: `/private/tmp/venueos-goodview-fit/gvbox-java/sources/com/mstar/android/media/MMediaPlayer.java`, enum near line 149 and setter near line 1679.
- Manual: `/Users/gschiemann/Downloads/Goodview_Cloud_User_Manual.pdf`, page 52 (printed page 51), section 11.2 Image.

Lead follow-up: ViewFactory.K creates MediaPlayer and binds a full-parent SurfaceHolder without changing scaling mode. VideoViewBitmap982/972/3328 onVideoSizeChanged callbacks are empty; the982 TextureView is match_parent in both axes. Android MediaPlayer.setVideoScalingMode documentation establishes the default as VIDEO_SCALING_MODE_SCALE_TO_FIT, defined as full-surface stretch without content cropping. This supports the expected video mapping for the inspected platform path; OEM physical behavior still needs bench verification. Primary source: https://developer.android.com/reference/android/media/MediaPlayer#VIDEO_SCALING_MODE_SCALE_TO_FIT and #setVideoScalingMode(int).
