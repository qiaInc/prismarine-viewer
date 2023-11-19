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

// TCPクライアントのセットアップと接続処理
function setupTcpClient(host, port, onConnected) {
  const client = new net.Socket();
  let isConnecting = false;

  client.on('connect', () => {
    console.log(`Connected to ${host}:${port}`);
    isConnecting = false;
    onConnected(client);
  });

  client.on('close', () => {
    console.log('Connection closed, attempting to reconnect...');
    attemptReconnect();
  });

  client.on('error', err => {
    console.error('Socket error:', err);
    attemptReconnect();
  });

  function attemptReconnect() {
    if (!isConnecting) {
      isConnecting = true;
      setTimeout(() => {
        client.connect(port, host);
      }, 1000); // 1秒後に再接続を試みる
    }
  }

  client.connect(port, host); // 初回接続を試みる
  return client;
}

module.exports = (
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
) => {
  const canvas = createCanvas(width, height);
  const renderer = new THREE.WebGLRenderer({ canvas });
  const viewer = new Viewer(renderer);

  viewer.setVersion(bot.version);
  viewer.setFirstPersonCamera(
    bot.entity.position,
    bot.entity.yaw,
    bot.entity.pitch,
  );

  // Load world
  const worldView = new WorldView(bot.world, viewDistance, bot.entity.position);
  viewer.listen(worldView);
  worldView.init(bot.entity.position);

  function botPosition() {
    viewer.setFirstPersonCamera(
      bot.entity.position,
      bot.entity.yaw,
      bot.entity.pitch,
    );
    worldView.updatePosition(bot.entity.position);
  }

  // Render loop streaming
  const rtmpOutput = output.startsWith('rtmp://');
  const ffmpegOutput = output.endsWith('mp4');
  // Added by @derodero24
  const tcpOutput = output.startsWith('tcp://');

  let client = null;

  if (rtmpOutput) {
    const fps = 20;
    const gop = fps * 2;
    const gopMin = fps;
    const probesize = '42M';
    const cbr = '1000k';
    const threads = 4;
    const args =
      `-y -r ${fps} -probesize ${probesize} -i pipe:0 -f flv -ac 2 -ar 44100 -vcodec libx264 -g ${gop} -keyint_min ${gopMin} -b:v ${cbr} -minrate ${cbr} -maxrate ${cbr} -pix_fmt yuv420p -s 1280x720 -preset ultrafast -tune film -threads ${threads} -strict normal -bufsize ${cbr} ${output}`.split(
        ' ',
      );
    client = spawn('ffmpeg', args);
    if (logFFMPEG) {
      client.stdout.on('data', data => {
        console.log(`stdout: ${data}`);
      });

      client.stderr.on('data', data => {
        console.error(`stderr: ${data}`);
      });
    }
    update();
  } else if (ffmpegOutput) {
    client = spawn('ffmpeg', ['-y', '-i', 'pipe:0', output]);
    if (logFFMPEG) {
      client.stdout.on('data', data => {
        console.log(`stdout: ${data}`);
      });

      client.stderr.on('data', data => {
        console.error(`stderr: ${data}`);
      });
    }
    update();
  } else if (tcpOutput) {
    // Added by @derodero24
    const [host, port] = output.substring(6).split(':'); // "tcp://"を削除
    client = setupTcpClient(host, port, client => {
      update(client); // クライアントが接続されたらレンダリングループを開始
    });
  } else {
    const [host, port] = output.split(':');
    console.log(`Connecting to ${host}:${port}`);
    client = new net.Socket();
    client.connect(parseInt(port, 10), host, () => {
      update();
    });
  }

  // Force end of stream
  bot.on('end', () => {
    frames = 0;
  });

  let idx = 0;
  function update() {
    viewer.update();
    renderer.render(viewer.scene, viewer.camera);

    const imageStream = canvas.createJPEGStream({
      bufsize: 4096,
      quality: 1,
      progressive: false,
      ...jpegOptions,
    });

    if (rtmpOutput || ffmpegOutput) {
      imageStream.on('data', chunk => {
        if (client.stdin.writable) {
          client.stdin.write(chunk);
        } else {
          console.log('Error: ffmpeg stdin closed!');
        }
      });
      imageStream.on('end', () => {
        idx++;
        if (idx < frames || frames < 0) {
          setTimeout(update, 16);
        } else {
          console.log('done streaming');
          client.stdin.end();
        }
      });
      imageStream.on('error', () => {});
    } else {
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
            if (idx < frames || frames < 0) {
              setTimeout(() => update(client), 16); // clientを再び渡す
            } else {
              client.end();
            }
          }
        })
        .catch(e => {
          console.log(e);
          // エラーが発生した場合、再接続の試みを行う
          client.destroy(); // 既存のソケットを閉じ、再接続をトリガーする
        });
    }
  }

  // Register events
  bot.on('move', botPosition);
  worldView.listenToBot(bot);

  return client;
};
