import { AssetFilesController } from './asset-files.controller';
import { existsSync } from 'fs';

jest.mock('fs', () => ({ existsSync: jest.fn(() => true) }));

describe('AssetFilesController download responses', () => {
  const controller = new AssetFilesController();
  const response = () => {
    const res = { setHeader: jest.fn(), sendFile: jest.fn(), download: jest.fn(), status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  beforeEach(() => jest.clearAllMocks());

  it('keeps media preview requests inline', () => {
    const res = response();
    controller.serveFile('abc.mp4', res as any);
    expect(res.sendFile).toHaveBeenCalledWith(expect.stringMatching(/\/abc\.mp4$/));
    expect(res.download).not.toHaveBeenCalled();
  });

  it('serves an attachment using the requested Unicode filename', () => {
    const res = response();
    controller.serveFile('abc.mp4', res as any, 'Café welcome.mp4');
    expect(res.download).toHaveBeenCalledWith(expect.stringMatching(/\/abc\.mp4$/), 'Café welcome.mp4');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('does not let an attachment name alter the selected file path', () => {
    const res = response();
    controller.serveFile('abc.mp4', res as any, '../private\r\n.mp4');
    expect(res.download).toHaveBeenCalledWith(expect.stringMatching(/\/abc\.mp4$/), '.._private__.mp4');
  });

  it('defaults an empty download parameter to the stored filename', () => {
    const res = response();
    controller.serveFile('abc.pdf', res as any, '');
    expect(res.download).toHaveBeenCalledWith(expect.stringMatching(/\/abc\.pdf$/), 'abc.pdf');
  });

  it('rejects non-string download parameters', () => {
    const res = response();
    controller.serveFile('abc.pdf', res as any, ['a', 'b'] as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.download).not.toHaveBeenCalled();
  });

  it('still rejects dot paths before attempting a download', () => {
    const res = response();
    controller.serveFile('..', res as any, 'safe.mp4');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(existsSync).not.toHaveBeenCalled();
    expect(res.download).not.toHaveBeenCalled();
  });
});
