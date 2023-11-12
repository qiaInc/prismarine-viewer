const fs = require('fs');

function safeRequire(path) {
  try {
    return require(path);
  } catch (e) {
    return {};
  }
}
const { loadImage } = safeRequire('node-canvas-webgl/lib');
const THREE = require('three');
const path = require('path');

const textureCache = {};
function loadTexture(texture, cb) {
  if (textureCache[texture]) {
    cb(textureCache[texture]);
  } else {
    // Fixed by @derodero24
    const texturePath = path.resolve(__dirname, '../../public/' + texture);

    // ファイルが存在しない場合はスキップ
    if (!fs.existsSync(texturePath)) {
      console.warn('[WARN] texture not found', texturePath);
      return;
    }

    loadImage(texturePath).then(image => {
      textureCache[texture] = new THREE.CanvasTexture(image);
      cb(textureCache[texture]);
    });
  }
}

function loadJSON(json, cb) {
  cb(require(path.resolve(__dirname, '../../public/' + json)));
}

module.exports = { loadTexture, loadJSON };
