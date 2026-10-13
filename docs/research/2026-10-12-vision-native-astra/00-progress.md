# Astra native-player investigation — preserved findings

Target identification pending user confirmation: Vision Core account, Venue-OS Media Player, X80/RK3328 Android11. Fresh telemetry shows1.1.33-field.1 and web3698181fdef5, but no nested lastVideoReport.native. Native runtime is fresh; heartbeat is not decoder proof.

Astra findings (source review, not final device root-cause verdict):

1. loop.backend='native' means browser HTMLVideoElement looping. Actual Android MediaCodec proof must be nested lastVideoReport.native. Need uploaded PLAYER_NATIVE_VIDEO_SKIPPED/FALLBACK/BLOCKED, prepare/fault and manifestHTTP lines plus actual nativeVideo descriptor and rollout tokens. SKIPPED is once perpage and maycapture initialprotocol=null, so correlatelaterfaults/timestamps.
2. Current source e68dab3b /1.1.33-field.1 claims solo video ABOVE WebView, but FaceVideoBox.kt:259 uses setZOrderMediaOverlay(true). OfficialAndroidcontract keeps theSurfaceView behind containingwindow; it onlyraisesaboveotherSurfaceViews. setZOrderOnTop(true) is actualabove-window API. Thuslastfix retains opacitydependency. Astra ischecking lifecycle/emergencyimplications beforeminimalcontrolledA/B. No livechangesorfinaldevicecauseclaimyet.

Primarydocumentation: https://developer.android.com/reference/android/view/SurfaceView#setZOrderMediaOverlay(boolean)

Currentnon-secretRailwayrolloutcontains explicit exclusion -13eb0b62-d420-4517-922e-e17700716fae. This explains currentbrowserfallback, not underlyingfailednativequalification; keepguarduntilcontrolledtestauthorized.

Astra also verified logging race: pageSKIPPEDcanoccurbeforeprotocolprobe oronhiddeninactive slide, MainActivitykeepsoneplaybackwarningper60s, upload3slaterthrottled10min. AninitialharmlessSKIPPEDmayconsume bothbudgets andhideactualFALLBACKseconds later. Needfullrawlog/timelines; absenceofFALLBACKearlyuploadisnotproofnoattempt.

Historicaleventanalysis: stage=presenting is set only after SharedVideoController receivesfresh=true (committedsession,attached/visibleflags,advancingpositiveuniqueFrames+viewUpdates,age<=2.5sec). ThusnativeDIDdecodethissha before22:26pause. activity-pausedcomesonlyfromMainActivity.onPause→suspendAll. next=stayisdeliberateowneranti-oscillationpolicyintroduced13:28UTC; no24hblock. Itlastsforsamemountedidentity/document. onResumeonlyresumesWebView/timers,nevernewnativeattempt. This reproduciblykeepsnativeoffafterpause; blindlyliftingwith30sretrywouldviolateprioruserrequirement. LogsdoNOTidentifypausecauseorprovephysicalpixels.
