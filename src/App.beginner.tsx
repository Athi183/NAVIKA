import { Canvas } from "@react-three/fiber";
// Import Canvas from React Three Fiber.
// Canvas is the container in which our Three.js 3D scene is rendered.

import { OrbitControls } from "@react-three/drei";
// Import OrbitControls from Drei.
// OrbitControls allows the user to rotate, zoom and pan around the 3D scene.
// Drei is a collection of useful helper components for React Three Fiber.


// Creating a reusable Floor component:
function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      {/* 
        mesh = a visible 3D object.
        It combines geometry (shape) and material (appearance).

        rotation = [X, Y, Z] rotation.
        We rotate the plane -90° around the X-axis
        so that it lies horizontally like a floor.
      */}

      <planeGeometry args={[20, 12]} />
      {/* 
        Creates the shape/geometry of the floor.
        Width = 20
        Height = 12
      */}

      <meshStandardMaterial color="lightgray" />
      {/* 
        Defines the appearance of the floor.
        The floor is light gray.
      */}
    </mesh>
  );
}


function Room() {
  return (
    <mesh position={[0, 1, 0]}>
      {/*
        position = [X, Y, Z]

        X = horizontal position
        Y = vertical position / height
        Z = depth position

        Therefore this room is positioned at:
        X = 0
        Y = 1
        Z = 0
      */}

      <boxGeometry args={[5, 2, 4]} />
      {/*
        Creates a rectangular box.

        Width  = 5
        Height = 2
        Depth  = 4
      */}

      <meshStandardMaterial color="white" />
      {/* Makes the room white. */}
    </mesh>
  );
}


function App() {
  return (
    <Canvas camera={{ position: [10, 8, 10], fov: 50 }}>
      {/*
        Creates the 3D scene.

        Camera position = [X, Y, Z]
        X = 10
        Y = 8
        Z = 10

        fov = Field of View.
        It controls how wide the camera can see.
      */}

      <ambientLight intensity={1} />
      {/* Provides general light throughout the scene. */}

      <directionalLight
        position={[5, 10, 5]}
        intensity={2}
      />
      {/*
        Creates a directional light coming from a particular direction.
        Its position is [5, 10, 5].
      */}

      <Floor />
      {/* Adds our Floor component to the 3D scene. */}

      <Room />
      {/* Adds our Room component to the 3D scene. */}

      <OrbitControls />
      {/* Allows the user to rotate, zoom and pan the camera. */}

    </Canvas>
  );
}

export default App;
// Makes App the default component exported from this file.