# Reusable Joystick Component

A drag-and-release UI component with directional labels and overlay support.

## Usage

```javascript
import { createJoystick } from './joystick.js'

// Create a joystick instance
const joystick = createJoystick({
  directions: ['left', 'right', 'up', 'down'],  // Optional: default is all 4
  labels: {
    left: 'Previous',
    right: 'Next',
    up: 'Confirm',
    down: 'Cancel'
  },
  onSelect: (direction) => {
    console.log('Selected direction:', direction)
    // Handle the direction selection
  },
  scale: 1  // Optional: scale the joystick size (default: 1)
})

// Render the joystick HTML
container.innerHTML = joystick.render()

// Attach event handlers
const cleanup = joystick.attach(container.querySelector('.joystick-container'))

// Later, cleanup when done
cleanup()
```

## Features

- **Automatic overlay**: Shows a full-screen overlay when dragging begins
- **Directional labels**: Configurable labels that appear and highlight based on drag direction
- **Resistance physics**: Natural feel with resistance beyond max distance
- **Dead zone**: Ignores tiny movements for better UX
- **Touch & mouse support**: Works with both touch and mouse events
- **Auto-cleanup**: Returns a cleanup function to remove all event listeners
- **Unique IDs**: Each instance gets unique element IDs to avoid conflicts

## Configuration

### `directions`
Array of enabled directions. Options: `'left'`, `'right'`, `'up'`, `'down'`

Default: `['left', 'right', 'up', 'down']`

### `labels`
Object mapping directions to label text.

Default:
```javascript
{
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down'
}
```

### `onSelect`
Callback function called when user releases after dragging past the activation threshold.

Receives: `direction` (string: 'left', 'right', 'up', or 'down')

### `scale`
Optional scale multiplier for the joystick size.

Default: `1`

## Example: Custom Three-Way Selector

```javascript
const selector = createJoystick({
  directions: ['left', 'right', 'up'],
  labels: {
    left: 'Cancel',
    right: 'Maybe',
    up: 'Confirm'
  },
  onSelect: (direction) => {
    const actions = {
      left: () => closeDialog(),
      right: () => saveForLater(),
      up: () => confirmAction()
    }
    actions[direction]?.()
  }
})

document.getElementById('dialog').innerHTML = selector.render()
selector.attach(document.querySelector('.joystick-container'))
```

## Styling

The component uses CSS classes from `styles.css`:
- `.joystick-container` - Main container
- `.joystick-stage` - Fixed-size interaction area
- `.joystick-stick` - Draggable circular handle
- `.joystick-label` - Direction labels
- `.joystick-overlay` - Full-screen overlay during drag

All styles are already defined and will work out of the box.
