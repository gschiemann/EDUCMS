import { Controller, Post, Get, Body, Param } from '@nestjs/common';

@Controller('api/v1/screens')
export class ScreensController {
  @Post('provision')
  provision(@Body() body: { shortcode: string; device_fingerprint: string }) {
    // Stub definition
    return {
      success: true,
      token: "jwt_token_stub",
      screen_id: "uuid_stub"
    };
  }

  @Get(':id/manifest')
  getManifest(@Param('id') id: string) {
    // Stub definition
    return {
      version: "1.0",
      playlists: [
        {
          id: "playlist_1",
          items: [
            {
              url: "https://example.com/asset.mp4",
              hash: "sha256_hash",
              duration_ms: 10000,
              sequence: 1
            }
          ]
        }
      ]
    };
  }
}
