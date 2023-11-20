const mineflayer = require('mineflayer');
const HeadlessViewer = require('prismarine-viewer').headless;

const bot = mineflayer.createBot({
  username: 'Bot',
  port: 56447, // 「LANに公開」したら値を変更
  username: 'Bot',
});

bot.once('spawn', () => {
  // Stream frames over tcp to a server listening on port 8089, ends when the application stop
  const client = new HeadlessViewer(bot, {
    output: 'localhost:8089',
    frames: -1,
    width: 512,
    height: 512,
  });
  bot.setControlState('jump', true);

  client.on('data', data => {
    const key = parseInt(data.toString(), 10);
    // console.log(key)
    bot.clearControlStates();
    if (key === 32) {
      // space
      bot.setControlState('jump', true);
    } else if (key === 81) {
      // left arrow
      bot.entity.yaw += 0.1;
    } else if (key === 82) {
      // top arrow
      bot.setControlState('forward', true);
    } else if (key === 83) {
      // right arrow
      bot.entity.yaw -= 0.1;
    } else if (key === 84) {
      // down arrow
      bot.setControlState('back', true);
    }
  });
});
