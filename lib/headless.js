/* global THREE */
function safeRequire(path) {
  try {
    return require(path);
  } catch (e) {
    return {};
  }
}
const { spawn } = require('child_process');
const net = require('net');
global.THREE = require('three');
global.Worker = require('worker_threads').Worker;
const { createCanvas } = safeRequire('node-canvas-webgl/lib');
const { WorldView, Viewer, getBufferFromStream } = require('../viewer');

class HeadlessViewer {
  /**
   * @param {import('mineflayer').Bot} bot
   * @param {object} options
   * @param {number} options.viewDistance
   * @param {string} options.output
   * @param {number} options.frames
   * @param {number} options.width
   * @param {number} options.height
   * @param {boolean} options.logFFMPEG
   * @param {object} options.jpegOptions
   * @param {number} options.jpegOptions.bufsize
   * @param {number} options.jpegOptions.quality
   * @param {number} options.jpegOptions.progressive
   */
  constructor(
    bot,
    {
      viewDistance = 6,
      output = 'output.mp4',
      frames = -1,
      width = 512,
      height = 512,
      logFFMPEG = false,
      jpegOptions,
    },
  ) {
    this.frames = frames;
    this.jpegOptions = jpegOptions;

    this.canvas = createCanvas(width, height);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });

    // Setup viewer
    this.viewer = new Viewer(this.renderer);
    this.viewer.setVersion(bot.version);
    this.viewer.setFirstPersonCamera(
      bot.entity.position,
      bot.entity.yaw,
      bot.entity.pitch,
    );

    // Load world
    this.worldView = new WorldView(
      bot.world,
      viewDistance,
      bot.entity.position,
    );
    this.viewer.listen(this.worldView);
    this.worldView.init(bot.entity.position);

    // 出力先に応じて処理を分岐
    if (output.endsWith('.mp4')) {
      const client = spawn('ffmpeg', ['-y', '-i', 'pipe:0', output]);
      if (logFFMPEG) {
        client.stdout.on('data', data => {
          console.log(`stdout: ${data}`);
        });
        client.stderr.on('data', data => {
          console.error(`stderr: ${data}`);
        });
      }
      this.client = client;
      this.updateMp4Frame(client);
    } else {
      const [host, port] = output.split(':');

      const client = new net.Socket();
      client.on('connect', () => {
        console.log(`Connected to ${host}:${port}`);
        this.updateSocketFrame(client); // レンダリングループ開始
      });
      client.on('close', () => console.log('Connection closed.'));
      client.on('error', err => console.error('Socket error:', err));

      // 接続
      console.log(`Connecting to ${host}:${port}`);
      client.connect(port, host);

      this.client = client;
    }

    // Force end of stream
    bot.on('end', () => {
      this.frames = 0;
    });
    bot.on('move', () => this.onBotMove(bot));

    this.worldView.listenToBot(bot);

    return this.client;
  }

  /**
   * @param {import('mineflayer').Bot} bot
   */
  onBotMove(bot) {
    this.viewer.setFirstPersonCamera(
      bot.entity.position,
      bot.entity.yaw,
      bot.entity.pitch,
    );
    this.worldView.updatePosition(bot.entity.position);
  }

  updateImgeStreem() {
    this.viewer.update();
    this.renderer.render(this.viewer.scene, this.viewer.camera);
    const imageStream = this.canvas.createJPEGStream({
      bufsize: 4096,
      quality: 1,
      progressive: false,
      ...this.jpegOptions,
    });
    return imageStream;
  }

  /**
   * @param {import('child_process').ChildProcessWithoutNullStreams} client
   * @param {number} idx
   */
  updateMp4Frame(client, idx = 0) {
    const imageStream = this.updateImgeStreem();
    imageStream.on('data', chunk => {
      if (client.stdin.writable) {
        client.stdin.write(chunk);
      } else {
        console.log('Error: ffmpeg stdin closed!');
      }
    });
    imageStream.on('end', () => {
      idx++;
      if (idx < this.frames || this.frames < 0) {
        setTimeout(() => this.updateMp4Frame(client, idx), 16);
      } else {
        console.log('done streaming');
        client.stdin.end();
      }
    });
    imageStream.on('error', () => {});
  }

  /**
   * @param {net.Socket} client
   * @param {number} idx
   */
  updateSocketFrame(client, idx = 0) {
    const imageStream = this.updateImgeStreem();
    getBufferFromStream(imageStream)
      .then(buffer => {
        // クライアントが有効かつ書き込み可能な場合にのみ実行
        if (client && client.writable) {
          const sizebuff = new Uint8Array(4);
          const view = new DataView(sizebuff.buffer, 0);
          view.setUint32(0, buffer.length, true);
          client.write(sizebuff);
          client.write(buffer);

          idx++;
          if (idx < this.frames || this.frames < 0) {
            setTimeout(() => this.updateSocketFrame(client, idx), 16); // 再帰
          } else {
            client.end();
          }
        }
      })
      .catch(console.error);
  }
}

module.exports = HeadlessViewer;
