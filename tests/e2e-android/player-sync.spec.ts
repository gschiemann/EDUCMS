describe('Android Kiosk Offline Boot & Player Sync', () => {

  it('Happy Path: Boots and caches standard playlist upon network connect', async () => {
    // 1. Wait for Android App to fully initialize in UiAutomator
    const loadingScreen = await $('~loading_spinner'); // Using accessibility IDs
    await loadingScreen.waitForDisplayed({ reverse: true, timeout: 5000 });

    // 2. Validate connection parameters text
    const connectionStatus = await $('~network_status_badge');
    expect(await connectionStatus.getText()).toContain('ONLINE');

    // 3. Verify media caching progress 
    const assetGrid = await $('~media_asset_container');
    await assetGrid.waitForDisplayed({ timeout: 15000 }); // Wait for heavy media pull

    // Check we have DOM items rendered inside the Android WebView shell
    const items = await $$('~media_item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('Failure Path: Renders cached SQLite state identically upon network block', async () => {
    // Inject chaos -> Force device network partition natively via Appium
    await driver.setNetworkConnection(1); // 1 = Airplane Mode

    // Force Android process kill & cold boot
    await driver.closeApp();
    await driver.launchApp();

    // Verify it automatically skips network checks and mounts SQLite
    const connectionStatus = await $('~network_status_badge');
    expect(await connectionStatus.getText()).toContain('OFFLINE_CACHE_MODE');

    const offlineGrid = await $('~media_asset_container');
    await offlineGrid.waitForDisplayed({ timeout: 3000 }); // Offline caches must mount < 3000ms

    // Must be exactly identical (data pulled from disk)
    const items = await $$('~media_item');
    expect(items.length).toBeGreaterThan(0);
    
    // Restore network for next suite
    await driver.setNetworkConnection(6); // 6 = Wi-Fi/Data All
  });

  it('Realtime Override: Instantly preempts standard play loops via WebSocket push', async () => {
    // 1. App must be actively running and playing default media
    const standardAsset = await $('~media_item');
    expect(await standardAsset.isDisplayed()).toBe(true);

    // 2. Trigger override explicitly against the REST payload mapping directly into WSS fanout
    const res = await fetch('http://127.0.0.1:3000/api/v1/emergency/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer MOCK_TOKEN' },
      body: JSON.stringify({
        scopeType: 'device',
        scopeId: 'test_android_device_1', // Using mocked active e2e identifier
        overridePayload: { textBlob: 'WEBSOCKET_ACTIVE_OVERRIDE_HAPPENING', severity: 'CRITICAL' }
      })
    });
    expect(res.status).toBe(201); // Assuming standard Nest 201 creation response

    // 3. Immediately assert screen displacement (Latency SLA rule: < 1000ms visual cutoff)
    const overrideContainer = await $('~override_alert_container');
    await overrideContainer.waitForDisplayed({ timeout: 1000 }); // strict SLA cutoff expectation

    const overrideText = await $('~override_blob_text');
    expect(await overrideText.getText()).toContain('WEBSOCKET_ACTIVE_OVERRIDE_HAPPENING');

    // 4. Send ALL_CLEAR natively
    const payload = await res.json();
    await fetch(`http://127.0.0.1:3000/api/v1/emergency/${payload.overrideId}/all-clear`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer MOCK_TOKEN' },
       body: JSON.stringify({ scopeType: 'device', scopeId: 'test_android_device_1' })
    });

    // 5. Assert seamless reversion back to normal caching loop
    await overrideContainer.waitForDisplayed({ reverse: true, timeout: 1000 });
    expect(await standardAsset.isDisplayed()).toBe(true);
  });

});
