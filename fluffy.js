const THREE = require('three')
const random = require('canvas-sketch-util/random')
const palettes = require('nice-color-palettes')
const glslify = require('glslify')
const { GUI } = require('dat.gui');
const canvasSketch = require('canvas-sketch')

const data = {
  shouldUpdate: false,
  shouldReset: false,
  palette: [],
  spikeLength: 1,
  spikeDetail: 0,
  reset: () => { } // only added this to get a nice Dat.GUI function button
};

const settings = {
  animate: true,
  context: 'webgl',
  attributes: { antialias: true },
  data
}

const sketch = ({ context, data }) => {
  /*
  *
  * SHADERS
  * 
  */
  const vertexShader = glslify(/* glsl */`
    #define PI 3.1415926538
    varying vec2 vUv;
    varying float uvNoise;
    uniform vec2 u_impulse;
    uniform float u_spikeCount;
    uniform float u_spikeLength;
    uniform float u_sceneRotationY;


    #pragma glslify: noise = require('glsl-noise/simplex/4d')
    void main () {
      vUv = uv;
      vec3 pos = position.xyz;
      // extrusion length based on simplex noise. Capping minimum at -1.0
      uvNoise = noise(vec4(position.xyz*u_spikeCount,10.0)) * u_spikeLength + (u_spikeLength - 1.0);
      float noiseLength = uvNoise * 0.39;
      pos += normal * noiseLength;

      // apply velocity only to vertices that 'stick' out
      if (uvNoise > 0.0) {
        float intensity = uvNoise * 5.0;

        // horizontal
        float impulseX = u_impulse.x;
        float angleH = atan(pos.z,pos.x);
        float hLength = length(vec2(pos.x,pos.z));
        float xpos = cos(angleH+impulseX*intensity) * hLength;
        float zPos = sin(angleH+impulseX*intensity) * hLength;

        // vertical
        // apply scene rotation to horizontal angle
        float zPos2 = sin(angleH+impulseX*intensity-u_sceneRotationY) * hLength;
        float angleV = atan(zPos2,pos.y) - u_impulse.y * intensity;
        float vLength = length(vec2(pos.y,zPos2));
        float yPos = cos(angleV) * vLength;
        pos = vec3(xpos,yPos,zPos);
      }
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `)


  const fragmentShader = glslify(/* glsl */`
    varying vec2 vUv;
    varying float uvNoise;
    uniform vec3 u_colorA;
    uniform vec3 u_colorB;
    uniform float u_time;
    uniform float u_spikeLength;

    #pragma glslify: noise3 = require('glsl-noise/simplex/3d')

    void main() {
      float sine = sin(vUv.x * 3.14);
      float n = noise3(vec3(vUv*6.0, u_time*0.02)) * 0.5 + 0.5;
      float darkness = (uvNoise / u_spikeLength + 1.0);
      vec3 col = mix(u_colorA,u_colorB,n);
      col = col * (sine * 0.6 + 0.4) * darkness;

      gl_FragColor = vec4(col,1.0);
    }
  `)

  /*
  *
  * SET UP DEFAULTS
  *
  */
  const createDefaults = () => {
    // using random seeds for colour, spike count and length to randomly choose between a known set of good outcomes
    const colorSeeds = [495948, 234144, 382666, 946739, 253862, 729250, 12290, 958027, 277064, 339463]
    const spikeSeeds = [614884, 383036, 191802, 967721, 384540, 111465]
    const spikeLengthSeeds = [533299, 122798]
    random.setSeed(random.pick(spikeSeeds))
    data.spikeDetail = random.range(1.35, 40)

    random.setSeed(undefined)
    random.setSeed(random.pick(spikeLengthSeeds))
    data.spikeLength = random.range(1.0, 1.4)

    random.setSeed(undefined)
    random.setSeed(random.pick(colorSeeds))
    data.palette = random.pick(palettes)
  }
  createDefaults()

  /*
  *
  * SET UP THREE.JS
  *
  */

  // Create a renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: context.canvas
  })

  // WebGL background color
  renderer.setClearColor('hsl(0,0%,95%)', 1)

  // Setup a camera
  const camera = new THREE.OrthographicCamera()
  camera.position.set(2, 1.3, -4)
  camera.lookAt(new THREE.Vector3())

  // Setup your scene
  const scene = new THREE.Scene()

  // Setup a geometry
  const geometry = new THREE.SphereGeometry(0.8, 256, 256)
  let mesh = null

  const createMesh = (reset = false) => {
    if (mesh != null) {
      scene.remove(mesh);
    }

    if (reset) {
      createDefaults()
    }

    const { spikeDetail, spikeLength, palette } = data

    mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        fragmentShader,
        vertexShader,
        uniforms: {
          u_time: { value: 0 },
          u_colorA: { value: new THREE.Color(palette[0]) },
          u_colorB: { value: new THREE.Color(palette[3]) },
          u_impulse: { value: new THREE.Vector2() },
          u_spikeCount: { value: spikeDetail },
          u_spikeLength: { value: spikeLength },
          u_sceneRotationY: { value: 0 }
        }
      })
    )
    scene.add(mesh)
  }
  createMesh()

  /*
  *
  * INTERACTION
  *
  */
  let isMouseDown = false
  let mouseList = [new THREE.Vector2(1, 1)]
  const currentImpulse = new THREE.Vector2()

  const getInputPosition = (e) => {
    let eX = e.clientX
    let eY = e.clientY
    if (e.touches && e.touches.length > 0) {
      // touch device
      var touch = e.touches[0]
      eX = touch.pageX
      eY = touch.pageY
    }
    eX = (eX / window.innerWidth) * 2 - 1
    eY = - (eY / window.innerHeight) * 2 + 1
    return {
      x: eX,
      y: eY
    }
  }
  const onMouseMove = (e) => {
    if (isMouseDown) {
      const { x, y } = getInputPosition(e)
      const lastMouse = mouseList.length > 0 ? mouseList[mouseList.length - 1] : new THREE.Vector2(x, y)
      mouseList.push(new THREE.Vector2(x, y))
      // check if scene is rotated upside down
      const direction = ((scene.rotation.x + Math.PI / 2) / Math.PI) % 2 > 1 ? -1 : 1
      currentImpulse.x += direction * (x - lastMouse.x) * 0.5
      currentImpulse.y -= (y - lastMouse.y) * 0.5
    }
  }
  const onMouseDown = (e) => {
    isMouseDown = true
    const { x, y } = getInputPosition(e)
    mouseList = [new THREE.Vector2(x, y)]
  }
  const onMouseUp = (e) => {
    isMouseDown = false
  }
  // add listeners
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('mousedown', onMouseDown, false);
  window.addEventListener('mouseup', onMouseUp, false);
  window.addEventListener('touchmove', onMouseMove, false);
  window.addEventListener('touchstart', onMouseDown, false);
  window.addEventListener('touchend', onMouseUp, false);

  /*
  *
  * RUNTIME
  *
  */
  return {
    // Handle resize events here
    resize({ pixelRatio, viewportWidth, viewportHeight }) {
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(viewportWidth, viewportHeight, false)
      const aspect = viewportWidth / viewportHeight;

      // Ortho zoom
      const zoom = aspect < 1 ? 2.5 : 1.5;

      // Bounds
      camera.left = -zoom * aspect;
      camera.right = zoom * aspect;
      camera.top = zoom;
      camera.bottom = -zoom;

      // Near/Far
      camera.near = -100;
      camera.far = 100;

      // Set position & look at world center
      camera.position.set(0, 0, zoom);
      camera.lookAt(new THREE.Vector3());

      // Update the camera
      camera.updateProjectionMatrix();
    },
    // Update & render your scene here
    render({ time, data }) {
      // recreate mesh if data prop has changed in Dat.GUI
      const { shouldReset, shouldUpdate } = data
      if (shouldReset) {
        data.shouldReset = false
        data.shouldUpdate = false
        createMesh(true)
      }
      if (shouldUpdate) {
        data.shouldUpdate = false
        createMesh()
      }

      // rotate scene
      currentImpulse.x *= 0.9
      currentImpulse.y *= 0.9
      scene.rotation.y += 0.003 + currentImpulse.x
      scene.rotation.x += currentImpulse.y

      // update uniforms
      mesh.material.uniforms.u_time.value = time
      mesh.material.uniforms.u_impulse.value = currentImpulse
      mesh.material.uniforms.u_sceneRotationY.value = scene.rotation.y

      // renderrrrr
      renderer.render(scene, camera)
    },
    // Dispose of events & renderer for cleaner hot-reloading
    unload() {
      renderer.dispose()
    }
  }
};

(async () => {
  await canvasSketch(sketch, settings);

  // Can disable this entirely
  const useGUI = true;
  if (useGUI) {
    const gui = new GUI();

    // Setup parameters
    gui.add(data, "spikeDetail", 1, 50, 0.01).name('Detail').onChange(() => {
      data.shouldUpdate = true
    }).listen()
    gui.add(data, "spikeLength", 1, 1.5, 0.01).name('Size').onChange(() => {
      data.shouldUpdate = true
    }).listen()
    gui.add(data, "reset").name("Regenerate").onChange(() => {
      data.shouldReset = true
    })
  }
})()