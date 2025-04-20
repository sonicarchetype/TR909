import {stringify, parse} from "zipson"

class Engine {

  /**
   * Main modifiable storage for presets
   * Organized in banks:
   * FACTORY 1: 0..15
   * FACTORY 2: 16..31
   * USER 1: 32..47
   * USER 2: 48..63
   * USER 3: 64..79
   * USER 4: 80..95
   * USER 5: 96..111
   * USER 6: 112..128
   */
  PRESETS = Array(128)
  
  /**
   * Recovery storage for presets.
   * When the user calls `RECALL` on the preset or bank, 
   * it will restore the original data from this backup.
   */
  PRESETS_RECALL = Array(128)
  
  /**
   * Hosts all rotary knobs settings.
   * Layout per knob:
   * `[value, rootDeg, setRootDeg]`
   * where:
   * - value: The calculated value based on the knob position
   * - rootDeg: The current rotation degree of the knob
   * - setRootDeg: Function to update the rotation degree
   */
  instSettings = {}

  /** 
   * Instrument to index conversion table.
   * Maps instrument codes to their respective track indices.
   * Note: HHC and HHO share the same track (3).
   */
  #I = {
    AC: 0, RD: 1, CR: 2,
    // hi-hats sit on the same track
    HHC: 3, HHO: 3, 
    HC: 4, RS: 5, 
    HT: 6, MT: 7, LT: 8,
    SD: 9, BD: 10, 
  }
  
  /** 
   * Instrument to verbose label conversion table.
   * Maps instrument codes to their full descriptive names.
   */
  #Iverbose = {
    AC: "TOTAL ACCENT", RD: "RIDE", CR: "CRASH",
    HHC: "CLOSED HAT", HHO: "OPEN HAT",
    HC: "HAND CLAP", RS: "RIM SHOT",
    HT: "HI TOM", MT: "MID TOM", LT: "LOW TOM",
    SD: "SNARE DRUM", BD: "BASS DRUM"
  }

  /** 
   * QWERTY keyboard mapping for pattern selection.
   * Maps pattern numbers to their corresponding keyboard keys.
   * Used for pattern selection via keyboard input.
   */
  QWERTYUI = "QWERTYUI"

  /** Debug mode flag */
  #debug
  
  /** Main pattern memory storage */
  #memory

  /** Shorthand for console.log */
  Log = console.log

  // Original TR-909's TEMPO wheel has specific mappings:
  // 7  o'clock => 37 BPM
  // 12 o'clock => 120 BPM
  // 5  o'clock => 290 BPM

  /** Total range of wheel rotation in degrees */
  #wheelRange = 300

  /** Middle tempo value (at 12 o'clock position) */
  #tempoWheelMid = 118
  
  /** Minimum tempo value (at 7 o'clock position) */
  #tempoWheelMin = 37
  
  /** Maximum tempo value (at 5 o'clock position) */
  #tempoWheelMax = 290
  
  /** Range of tempo values for left half of wheel */
  #tempoRangeL = this.#tempoWheelMid - this.#tempoWheelMin
  
  /** Range of tempo values for right half of wheel */
  #tempoRangeR = this.#tempoWheelMax - this.#tempoWheelMid

  /** Minimum instrument volume value */
  #instVolumeMin = 0
  
  /** Maximum instrument volume value */
  #instVolumeMax = 100
  
  /** Range of instrument volume values */
  #instVolumeRange = this.#instVolumeMax - this.#instVolumeMin

  /** Slope for left half of tempo wheel (change in tempo per degree) */
  #tempoSlopeL = this.#tempoRangeL / (this.#wheelRange / 2)
  
  /** Slope for right half of tempo wheel (change in tempo per degree) */
  #tempoSlopeR = this.#tempoRangeR / (this.#wheelRange / 2)
  
  /** Slope for instrument volume knobs (change in volume per degree) */
  #instVolumeSlope = this.#instVolumeRange / this.#wheelRange
  
  /** Offset for instrument volume to center the range */
  #instVolumeOffset = this.#instVolumeRange / 2 // the amount we need to raise the function up to have correct mapping as 0 - 100

  /**
   * Simple linear mapping function for most rotary controls
   * @param {number} value - The input value (typically degrees of rotation)
   * @param {number} slope - The rate of change (default: instrument volume slope)
   * @param {number} offset - The offset to apply (default: instrument volume offset)
   * @returns {number} The mapped output value
   */
  #linearFoo = (
    value,
    slope = this.#instVolumeSlope,
    offset = this.#instVolumeOffset) => {
    return slope * value + offset
  }

  /**
   * Piecewise linear function for tempo wheel mapping
   * Uses different slopes for left and right halves of the wheel
   * @param {number} value - The input value (degrees of rotation)
   * @param {number} slopeL - The slope for negative values (left half)
   * @param {number} slopeR - The slope for positive values (right half)
   * @param {number} offset - The center value (at 0 degrees)
   * @returns {number} The mapped tempo value
   */
  #tempoWheelPieceWiseFoo = (
    value,
    slopeL = this.#tempoSlopeL,
    slopeR = this.#tempoSlopeR,
    offset = this.#tempoWheelMid) => {
    return (value <= 0 ? slopeL * value : slopeR * value) + offset
  }

  /**
   * Exponential mapping function for tempo wheel (128 BPM centered)
   * @param {number} value - The input value (degrees of rotation)
   * @returns {number} The mapped tempo value
   */
  #tempoWheelExpFoo128 = (value) => {
    return 128 - (-0.7983337 / -0.003844912) * (1 - Math.E ** (+0.003844912 * value))
  }
  
  /**
   * Exponential mapping function for tempo wheel (118 BPM centered)
   * @param {number} value - The input value (degrees of rotation)
   * @returns {number} The mapped tempo value
   */
  #tempoWheelExpFoo118 = (value) => {
    return 118 - (-0.7686027 / -0.005020302) * (1 - Math.E ** (+0.005020302 * value))
  }

  /**
   * Sets or clears the last active wheel indicator
   * @param {string} elementId - ID of the wheel element
   * @param {boolean} switchOff - If true, turns off the indicator
   */
  setLastActive(elementId, switchOff=false) {
    if (switchOff) {
      this.lastActiveWheel && this.StateSetters[this.lastActiveWheel](false)
      this.lastActiveWheel = false
      return
    }
    if (elementId !== 'tempo_wheel' && elementId !== 'volume_wheel') {
      this.lastActiveWheel && this.StateSetters[this.lastActiveWheel](state => !state) 
      this.StateSetters[elementId + 'law'](state => !state)
      this.lastActiveWheel = elementId + 'law'
    }
  }

  /**
   * Sets the value for a rotary control based on its position
   * Maps the physical rotation to the appropriate parameter value
   * @param {string} elementId - ID of the rotary control
   * @param {number} rootDeg - Current rotation in degrees
   * @param {Function} setRootDeg - Function to update rotation
   */
  setRotaryValue(elementId, rootDeg, setRootDeg) {
    switch (elementId) {
      case 'tempo_wheel': {
        this.instSettings[elementId] = [Math.round(this.#tempoWheelPieceWiseFoo(rootDeg)), rootDeg, setRootDeg]
        // this.Log("setRotaryValue=> ", elementId, rootDeg, this.instSettings[elementId])
        break
      }
      default: {
        this.instSettings[elementId] = [Math.floor(this.#linearFoo(rootDeg)), rootDeg, setRootDeg]
        // this.Log("setRotaryValue=> ", elementId, rootDeg, this.instSettings[elementId])
      }
    }
  }

  /** Placeholder for tempo setting function */
  setTempo = () => { }
  
  /** Placeholder for instrument setting function */
  setInst = () => { }

  /** Flag to track if playback was stopped specifically for Safari */
  #safariPlaybackStop = false
  
  /**
   * Returns whether playback was stopped for Safari compatibility
   * @returns {boolean} True if playback was stopped for Safari
   */
  getIfSafariPlayback = () => { return this.#safariPlaybackStop }
  
  /**
   * Stops playback specifically for Safari if currently playing
   * Used to handle Safari-specific audio context limitations
   */
  async safariOnlyStopIfPlayed() {
    // this.Log('safariOnlyStopIfPlayed', this.GLOBAL_SSC)
    if (this.GLOBAL_SSC !== 'STOP') {
      this.DisplaySetters['STOP']('', 'STOP')
      this.#safariPlaybackStop = true
      this.#audioCtx.suspend()
    }
  }
  
  /**
   * Resumes playback if it was stopped specifically for Safari
   */
  safariOnlyResumeIfStopped() {
    // this.Log('safariOnlyResumeIfStopped', this.GLOBAL_SSC)
    if (this.#safariPlaybackStop) {
      this.DisplaySetters['STOP']('', 'CONT')
      this.#safariPlaybackStop = false
    } 
  }

  /**
   * Collection of functions that handle display updates and related actions
   * Each function corresponds to a specific control element
   */
  DisplaySetters = []
  
  /**
   * Initializes the DisplaySetters collection with handler functions
   * for various control elements
   */
  #createDisplaySetters() {
    // Handle tempo wheel changes
    this.DisplaySetters['tempo_wheel'] = (elementId) => {
      this.setTempo(this.instSettings[elementId][0])
    },

    // Handle START button press
    this.DisplaySetters['START'] = (elementId) => {
      this.GLOBAL_SSC = elementId
      this.#playback(elementId)
    },

    // Handle STOP/CONT button press
    this.DisplaySetters['STOP'] = (elementId, payload) => {
      this.GLOBAL_SSC = payload
      this.#playback(payload)
    },
    
    // Handle Global LED Control Variable changes
    this.DisplaySetters['GLCV'] = (elementId, payload) => {
      this.setLCV(() => {
        switch (payload) {
          case 'TEMPO-STEP': return 'TEMPO'
          case 'BACK-TAP': return 'BACK'
          default: return payload
        }
      })
      // this.Log('engine => GLCV:', this.GLOBAL_LED_CONTROL_VARIABLE()) 
    },

    // Handle SCALE changes
    this.DisplaySetters['SCALE'] = (elementId, payload) => {
      this.setSCALE([payload, this.#GLOBAL_SCALE]) 
    },

    // Handle Clear Entry / Tap mode changes
    this.DisplaySetters['CE-TA'] = (elementId, payload) => {
      this.GLOBAL_Mk_TA = payload
      // this.Log('=> CE-TA payload:', payload)
      payload ? 
        this.setLCV('SHIFT' + ' ' + '+TA') :
        this.setLCV('SHIFT') 
    }
  }

  /**
   * Routes display update requests to the appropriate handler function
   * @param {string} elementId - ID of the element triggering the update
   * @param {*} payload - Additional data for the update
   */
  setDisplay(elementId, payload) {
    let foo = this.DisplaySetters[elementId]
    if(foo) {
      foo(elementId, payload)
      return
    }
  }

  // ====== CONTROL FLOW VARIABLES ====== //

  /** 
   * Global Start/Stop/Continue state
   * Possible values: 'START', 'STOP', 'CONT'
   */
  GLOBAL_SSC = 'STOP'
  
  /** Stores the previous state of GLOBAL_SSC for state restoration */
  lastGLOBAL_SCC = this.GLOBAL_SSC 

  /** Flag indicating if tempo step mode is active */
  #tempoStep = false

  /**
   * Function to set the LED Control Variable
   * MUST be undefined before any dependency is called;
   * if not, an action is ongoing
   */
  setLCV = () => { }
  
  /** 
   * Returns the current Global LED Control Variable 
   * @returns {string|undefined} The current GLCV value
   */
  GLOBAL_LED_CONTROL_VARIABLE = () => {return this.#GLCV}

  /** Private storage for the Global LED Control Variable */
  #GLCV
  
  /**
   * Manages the setting or replacing of the Global LED Control Variable (GLCV).
   * @param {boolean} GLCV - Whether to set (true) or clear (false) the GLCV
   * @param {string} elementId - Element ID to set as the new GLCV when GLCV is true
   * @returns {void}
   */
  #manageGLCV (GLCV, elementId) {
    if (GLCV) {
      this.#GLCV_SWAP(elementId)
    } else { 
      this.#GLCV = undefined
      if (this.TRACK_WRITE) {
        this.setDisplay('GLCV', 'SHIFT')
        return
      }
      this.setDisplay('GLCV', undefined)
    }
  }
  
  /**
   * Swaps the current GLCV with a new one, handling cleanup of the previous state.
   * @param {string} elementId - Element ID to set as the new GLCV
   */
  #GLCV_SWAP (elementId) {
    switch (this.#GLCV) {
      case 'INST SELECT':
        this.StateSetters['INST SELECT'](false)
        this.#instSelect = false
        break
      case 'SHUFF /FLAM':
        this.StateSetters['SHUFF /FLAM'](false)
        this.#shuffleFlam = false
        break 
      case 'LAST STEP':
        this.StateSetters['LAST STEP'](false)
        this.#LAST_STEP = false
        break
      case 'TEMPO':
        this.StateSetters['TEMPO-STEP'](false)
        this.#tempoStep = false
        break
      // here we use a screen name instead of elementId
      case 'TOTAL ACCENT':
        this.StateSetters['CE-TA'](false)
        this.GLOBAL_Mk_TA = false

        this.SELECTED_INST = this.lastSELECTED_INST
        this.setSelInst(
          this.GLOBAL_MODE==='TAP'?
          'ALL':this.lastSELECTED_INST)
          this.setMksState()
        break

      default: break
    }

    this.#GLCV = elementId
    this.setDisplay('GLCV', elementId)
    this.highlightSelectedInstrument()
    // this.Log('GLCV+++', this.#GLCV)
  }

  /** Function to set the current scale */
  setSCALE = () => { }
  
  /** Current global scale value (1-4) */
  #GLOBAL_SCALE = 1
  
  /** Function to set the Y position of the scale light indicator */
  setSCALELightY = () => { }
  
  /** Y-coordinate positions for the scale light based on scale value */
  #scale_light_Y = [101, 75, 49, 23]

  /**
   * TOTAL ACCENT MainKey flag
   * Works only if `GLOBAL_LED_CONTROL_VARIABLE === 'SHIFT'`,
   * permits `AC_` setting to be written
   */
  GLOBAL_Mk_TA = false

  /** Function to toggle between STEP and TAP modes */
  setStepTap = () => {}
  
  /**
   * Current global mode - either 'STEP' or 'TAP'
   * STEP mode shows normal pattern view
   * TAP mode shows a diagonal slice of the pattern
   */
  GLOBAL_MODE = 'STEP'

  /** Table of handlers for when SHIFT is not active */
  #NO_SHIFT_TABLE = []
  
  /** Table of handlers for when SHIFT is active */
  #SHIFT_TABLE = []

  /**
   * Flag that allows user to change the BASE when true
   * Controls the LAST STEP functionality
   */
  #LAST_STEP = false
  
  /** Stores the last edited pattern for undo/recovery */
  #lastEditedPattern = []

  /** Flag indicating if pattern cycling is enabled */
  #CYCLE = false

  /** Flag indicating if the queue table UI is currently open */
  isQueueTable = false

  /** Flag indicating if the bank table UI is currently open */
  isBankTable = false

  /**
   * Current queue table slot in the format String(QTa)+slot_index_number
   * Example: 'QTa0', 'QTa1', etc.
   */
  #currentQTSlot = 'QTa0'
  
  /**
   * Switches between queue table slots
   * @param {number} patternAddress - Index address within the playbackQueue associated with a particular QT slot
   */
  switchQTSlot (patternAddress=undefined) {
    // we switch to the slot only if the playbackQueue contains a pattern in it.
    if (this.#playbackQueue[patternAddress]) {
      this.#patternNumber = patternAddress
      this.StateSetters[this.#currentQTSlot](false)
      let slotCode = 'QTa'+patternAddress
      this.StateSetters[slotCode](true)
      this.#currentQTSlot = slotCode
      return
    }
    this.StateSetters[this.#currentQTSlot](true) 
  }

  /**
   * Processes LED key presses and routes them to the appropriate handler
   * @param {string} elementId - ID of the LED key that was pressed
   * @param {*} payload - Additional data associated with the key press
   */
  consumeLedKey = (elementId, payload) => {
    // In QUEUE mode we do not allow any other key to work except CG
    
    // let foo = this.GLOBAL_LED_CONTROL_VARIABLE==='SHIFT'?
    let foo = this.TRACK_WRITE?
    this.#SHIFT_TABLE[elementId]:this.#NO_SHIFT_TABLE[elementId]
    if (foo) {
      foo(elementId, payload)
      // this.Log('consumeLedKey ', elementId)
      return
    } 
    // this.Log('consumeLedKey: not implemented or not supported:', elementId)  
  }

  /**
   * Clears the display's LCV field or sets it to a specified value
   * @param {string} insertedValue - Value to insert in the LCV field (default: empty string)
   */
  clearLCVDisplay = (insertedValue='') => {
    // this.isSCALE = false
    this.setLCV(insertedValue)
    this.setDisplay('SCALE', false)
  }

  /**
   * Updates the visual state of main keys when BASE changes
   * Fades out keys that are outside the current BASE range
   */
  #fadeOutMainKeysForNewBASE () {
    // true - means yes, do fade out.

    // turn all OFF at first
    for (let i=0; i<this.BASE; i++) {
      this.StateSetters[i+43](false)
    }
    for (let i=0; i<this.firstBeat; i++) {
      this.StateSetters[i+43](true)
    }  
    for (let i=this.BASE; i<16; i++) {
      this.StateSetters[i+43](true)
    }
  }

  /**
   * Updates the metrical grid based on the current GLOBAL_SCALE value
   * Called when the user changes the metrical BASE
   */
  #changeGridForNewBASE () {
    // this.Log('GLOBAL_SCALE', this.#GLOBAL_SCALE)
    switch(this.#GLOBAL_SCALE) {
      case 1:
        this.#grid = 4
        break
      case 2:
        this.#grid = 8
        break
      case 3:
        this.#grid = 3
        break
      case 4:
        this.#grid = 6
        break
    }
    this.#fadeOutMainKeysForNewBASE()
  }

  /**
   * Updates the invert state and beat runner counter when pattern direction changes
   * Invert controls whether the pattern plays forward or backward
   */
  #updateInvert() {
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]

    let newInvert = patternLocation[17]

    let firstBeat = patternLocation[16]
    let BASE = patternLocation[12]
    if (newInvert !== this.invert) {
      // this.Log("\tA:invert:newInvert:", this.invert, newInvert, patternLocation[16], patternLocation[12])
      this.#beatRunnerCounter = !newInvert?firstBeat+1:BASE-2
      this.invert = newInvert
    } else {
      // this.Log("\tB:invert:newInvert:", this.invert, newInvert, patternLocation[16], patternLocation[12])
      this.#beatRunnerCounter = !newInvert?firstBeat-1:BASE
    }

    // this.invert = newInvert
    this.StateSetters['TS-PM'](this.invert)
    // this.Log('updateInvert:beatRunnerCounter', this.#beatRunnerCounter)
  }

  /** 
   * Updates SCALE and BASE settings when switching to a new pattern
   * @param {boolean} [clearLCVDisplay=true] - If true, clears the Global Control Variable from the display
   */
  #updateScaleBase (clearLCVDisplay=true) {
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]

    this.#GLOBAL_SCALE = patternLocation[11]
    this.setSCALELightY(this.#scale_light_Y[this.#GLOBAL_SCALE - 1])
    this.setSCALE([true, this.#GLOBAL_SCALE])
    // clearLCVDisplay&&this.clearLCVDisplay()

    this.BASE = patternLocation[12]
    this.firstBeat = patternLocation[16]
  }

  /**
   * Updates SHUFFLE and FLAM settings when switching to a new pattern
   * Updates both the internal values and the UI indicators
   */
  #updateSHUFFLEandFLAM () {
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]
    
    this.#shuffleFactor = patternLocation[13]
    this.#flamFactor = patternLocation[14]

    let shuffleKey = Math.round(this.#shuffleFactor*this.#swingFactor)+1
    let flamKey = this.#flamFactor*this.#flamSpread+8+1 

    // Also we bring new info to the dashboard
    // this.StateSetters['setDShuffle'](
    //   shuffleKey)
    // this.StateSetters['setDFlam'](
    //   flamKey)

    // Update shuffle
    this.StateSetters[this.#shuffleFlamPair[0]](false) 
    this.StateSetters[shuffleKey + 58] (true)
    this.#shuffleFlamPair[0] = shuffleKey + 58
    // Update flam
    this.StateSetters[this.#shuffleFlamPair[1]](false) 
    this.StateSetters[flamKey + 58] (true)
    this.#shuffleFlamPair[1] = flamKey + 58
  }

  /** Stores the current keyboard key being pressed */
  currentKeyboardKey = undefined
  
  /** ID for the timeout that clears the current keyboard key */
  #currentKeyboardKeyID = undefined
  
  /** ID for the timeout that turns off scale display */
  #scaleOffID

  /**
   * Records the current keyboard key and sets a timeout to clear it
   * @param {string} currentKey - The key that was pressed
   * @param {number} time - Time in milliseconds before the key is cleared
   */
  collectCurrentKeyboardKey (currentKey, time) {
    clearTimeout(this.#currentKeyboardKeyID)
    this.currentKeyboardKey = currentKey
    
    this.#currentKeyboardKeyID = setTimeout(() => {
      this.currentKeyboardKey = undefined
      clearTimeout(this.#currentKeyboardKeyID)
      // this.Log('currentKeyboardKey is cleared')
    }, time)
  }

  /** Flag for shuffle/flam mode */
  #shuffleFlam = false
  
  /** Flag for instrument selection mode */
  #instSelect = false
  
  /** Flag for guide mode */
  #guide = false
  
  /**
   * Returns the current state of the guide mode
   * @returns {boolean} True if guide mode is active, false otherwise
   */
  isGuide = () => { return this.#guide }

  /**
   * Called when SHIFT is turned off. 
   * Ensures SHUFF/FLAM, LAST STEP and INST SELECT are turned off.
   * Resets all shift-related states to their default values.
   */
  ensureSHIFTFallsBackClean () {
    this.StateSetters['SHUFF /FLAM'](false)
    this.#shuffleFlam = false

    this.StateSetters['LAST STEP'](false)
    this.#LAST_STEP = false

    this.StateSetters['INST SELECT'](false)
    this.#instSelect = false

    this.StateSetters['TEMPO-STEP'](false)
    this.#tempoStep = false

    this.StateSetters['CE-TA'](false)
    this.GLOBAL_Mk_TA = false

    this.StateSetters['ALT'](false)
    this.#altKey = false

    this.#GLCV = undefined

    // clear the COPY_TO_BUFFER and update the Mk(s) light
    this.#clearCOPY_TO_BUFFER()
    this.#COPY_TO = false
    // we turn OFF the COPY key to give the user an indication that they are
    // out of the SHIFT and COPY modes.
    this.#switchEditKeysLights('COPY', true)
  }

  /**
   * Clears the copy-to buffer and resets related UI elements
   * 
   * This method clears all patterns or presets from the copy buffer and updates
   * the UI to reflect this change. It turns off all copy mode indicators for
   * elements that were in the buffer and optionally resets the tempo display
   * and COPY button light.
   * 
   * @param {boolean} changeLED - Whether to reset the tempo display and turn off the COPY button light
   * @param {boolean} presets - Whether the buffer contains presets (true) or patterns (false)
   * @private
   */
  #clearCOPY_TO_BUFFER(changeLED=true, presets=false) {
    // Turn off copy mode indicators for all patterns in buffer
    if (presets) {
      for (const el of this.#COPY_TO_BUFFER.keys()) {
        this.StateSetters['PRa'+el+'cm'](false);
      }
    } else {
      for (const el of this.#COPY_TO_BUFFER.keys()) {
        this.StateSetters[el+'cm'](false);
      }
    }
    
    // Clear the buffer completely
    this.#COPY_TO_BUFFER.clear();
    
    // Reset tempo display if requested
    if (changeLED) {
      this.setTempo(this.instSettings['tempo_wheel'][0]);
      
      // Turn off COPY button light
      this.#switchEditKeysLights('COPY', true);
    }
  }

  /**
   * Updates the location component in all selector codes stored in the copy buffer
   * 
   * When a track or bank is changed while in copy mode, this method ensures that
   * all patterns in the copy buffer are updated to use the new track or bank.
   * 
   * @param {string} elementId - The ID of the new element (track or bank)
   * @param {number} location - The index in the selector code to update (0 for bank, 1 for track, 2 for pattern group)
   * @private
   */
  #updateCOPYLocation(elementId, location) {
    if (this.#COPY_TO && this.#COPY_TO_BUFFER.size > 0) {
      for (let selectorCode of this.#COPY_TO_BUFFER.values()) {
        selectorCode[location] = elementId
      }
    }
  }

  /** Flag for alt key state */
  #altKey = false
  
  /**
   * Returns the current state of the alt key
   * @returns {boolean} True if alt key is active, false otherwise
   */
  isAltKey = () => { return this.#altKey }
  
  /**
   * Creates the command tables for shift and non-shift modes
   * Maps button IDs to their corresponding functions
   * @private
   */
  #createTables = () => {
    // ALT key toggles alternative mode
    this.#NO_SHIFT_TABLE['ALT'] = () => {
      this.#altKey = !this.#altKey
      this.StateSetters['ALT'](state => !state)
      // this.Log('ALT: glcv', this.isAltKey(), this.#GLCV)
      // Handle special case for LAST STEP when ALT is pressed
      if (this.#GLCV==='LAST STEP') {
        this.#altKey ? this.setLCV('FIRST STEP') : this.setLCV('LAST STEP ')
      }
    }
    
    /**
     * BACK command selects the previous consecutive pattern in the QueueTable, 
     * or in the PatternGroup if the QueueTable is hidden.
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['BACK-TAP'] = (elementId) => {
      if (!this.TRACK_WRITE) {
        // Visual feedback - briefly light up the button
        const bkw = document.getElementById(elementId)
        bkw.classList.add('red-light')
        this.#handleClickMkTimeOut.push(setTimeout(() => {
          bkw.classList.remove('red-light')
        }, 100))
      }
      
      // Get current pattern and move to previous (with ring buffer behavior)
      let currentPatternNumber = this.SELECTOR_CODE[3]
      this.changePattern((16+(currentPatternNumber - 1))%16)
      
      // Update queue table if visible
      if (this.isQueueTable) {
        this.StateSetters['QT'+this.#patternNumber](state => !state)
        this.setPatternLocation(this.SELECTOR_CODE)
      }
    }
    
    /**
     * FWD command selects the next consecutive pattern in the QueueTable, 
     * or in the PatternGroup if the QueueTable is hidden.
     * FWD command is attached to B1 key.
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['B1'] = (elementId) => {
      if (!this.TRACK_WRITE) {
        // Visual feedback - briefly light up the button
        const fwd = document.getElementById(elementId)
        fwd.classList.add('red-light')
        this.#handleClickMkTimeOut.push(setTimeout(() => {
          fwd.classList.remove('red-light')
        }, 100))
      }

      // Get current pattern and move to next (with ring buffer behavior)
      let currentPatternNumber = this.SELECTOR_CODE[3]
      this.changePattern((currentPatternNumber + 1)%16)
      
      // Update queue table if visible
      if (this.isQueueTable) {
        this.StateSetters['QT'+this.#patternNumber](state => !state)
        this.setPatternLocation(this.SELECTOR_CODE)
      }
    }
    
    /**
     * B2 button displays information about available patterns to program
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['B2'] = (elementId) => {
      // Temporarily display available patterns count
      clearTimeout(this.#availablePatternOffID)
      this.setTempo(this.#availablePatterns)
      this.#availablePatternOffID = setTimeout(
        () => {
          // Restore normal display after timeout
          this.#GLCV ?
            this.clearLCVDisplay(this.GLOBAL_LED_CONTROL_VARIABLE()) :
            this.setTempo(this.instSettings['tempo_wheel'][0])
        }, 
        1000)
    }

    /**
     * SHUFF/FLAM button handler for non-shift mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['SHUFF /FLAM'] = (elementId) => {}

    /**
     * LAST STEP button handler for non-shift mode
     * Removes the last pattern from the queue when in queue mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['LAST STEP'] = (elementId) => {
      /* Related to the QUEUE MODE */
      if (this.isQueueTable) {
        // Remove last pattern from queue if more than one pattern exists
        if (this.#playbackQueue.length > 1) {
          this.#playbackQueue.pop()
        } else {
          // If only one pattern, reset it to current selection
          this.#playbackQueue[0] = this.SELECTOR_CODE.slice()
        }
        
        // Update queue table display
        this.StateSetters['QT'+this.#playbackQueue.length](state => state+=1)

        /**
         * The LAST STEP when deleting the last pattern of the QT,
         * and when the last pattern was the selected pattern,
         * intentionally does not jump to the new last pattern
         * but stays on the empty place letting it finish playing.
         * On the contrary, using DEL key, always switches to the last
         * available pattern of QT when such condition happens.
         */

        // Update queue length display
        this.StateSetters['setQueueLen'](this.#playbackQueue.length)
        this.StateSetters['setLastPat'](this.#playbackQueue[
          this.#playbackQueue.length-1][3]+1)

        // Turn off LAST STEP key if only one pattern remains
        this.getPlaybackQueueLength()===1 &&
          this.StateSetters['LAST STEP-reload'](state => !state)

        // this.Log('playbackQueue:', this.#playbackQueue)

        return
      }
    }

    /**
     * CG (Cycle Group) button handler - toggles cycle mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['CG'] = (elementId) => {  
      this.StateSetters[elementId](state => !state)
      this.#CYCLE = !this.#CYCLE
      this.StateSetters['setDInfinitySign'](this.#CYCLE)

      // this.Log('CG:', this.#CYCLE) 
    }

    /**
     * CLEAR button handler for non-shift mode
     */
    this.#NO_SHIFT_TABLE['CLEAR'] = () => {}

    /**
     * TEMPO-STEP button handler - toggles tempo step mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['TEMPO-STEP'] = (elementId) => {
      this.StateSetters[elementId](state => !state)
      this.#tempoStep = !this.#tempoStep

      this.#manageGLCV(this.#tempoStep, 'TEMPO')
    },

    /**
     * INST SELECT button handler - toggles instrument selection mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['INST SELECT'] =  (elementId) => {
      this.StateSetters[elementId](state => !state)
      this.#instSelect = !this.#instSelect

      this.#manageGLCV(this.#instSelect, elementId)
    },

    /**
     * SCALE button handler for non-shift mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['SCALE'] = (elementId) => {},

    /**
     * Track 1 button handler - selects track 1
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['T1'] = (elementId) => {
      // Update selector code with track ID
      this.SELECTOR_CODE[1] = elementId
      if (this.TRACK_WRITE) {
        this.#playbackQueue[this.#patternNumber][1] = elementId
      }

      this.#updateCOPYLocation(elementId, 1)

      // Update UI state
      this.StateSetters['TrackKeys'](state => !state)
      this.setMksState()
      this.updatePatternAndInstSTEP()

      // Update pattern settings
      this.#updateScaleBase()
      this.#updateSHUFFLEandFLAM()
      this.#changeGridForNewBASE()

      // this.Log('T1: SELECTOR_CODE:', this.SELECTOR_CODE)
      // this.Log('T1: playbackQueue:out', this.#playbackQueue, this.#patternNumber)
    },

    // Track buttons 2-4 use the same handler as T1
    this.#NO_SHIFT_TABLE['T2'] = (elementId) => this.#NO_SHIFT_TABLE.T1(elementId),
    this.#NO_SHIFT_TABLE['T3'] = (elementId) => this.#NO_SHIFT_TABLE.T1(elementId),
    this.#NO_SHIFT_TABLE['T4'] = (elementId) => this.#NO_SHIFT_TABLE.T1(elementId),

    /**
     * Pattern Group 1 button handler - selects pattern group 1
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['PG1'] = (elementId) => {
      // Update selector code with pattern group ID
      this.SELECTOR_CODE[2] = elementId
      if (this.TRACK_WRITE) {
        this.#playbackQueue[this.#patternNumber][2] = elementId
      }

      this.#updateCOPYLocation(elementId, 2)

      // Update UI state
      this.StateSetters['PatternGroupKeys'](state => !state)
      this.updatePatternAndInstSTEP()
      this.setMksState()

      // Update pattern settings
      this.#updateScaleBase()
      this.#updateSHUFFLEandFLAM()
      this.#changeGridForNewBASE()

      // this.Log('SELECTOR_CODE:', this.SELECTOR_CODE) 
    },

    // Pattern Group buttons 2-3 use the same handler as PG1
    this.#NO_SHIFT_TABLE['PG2'] = (elementId) => this.#NO_SHIFT_TABLE.PG1(elementId),
    this.#NO_SHIFT_TABLE['PG3'] = (elementId) => this.#NO_SHIFT_TABLE.PG1(elementId) 

    /**
     * TS-PM (Time Signature - Play Mode) button handler - toggles invert mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#NO_SHIFT_TABLE['TS-PM'] = (elementId) => {
      this.invert = this.invert ? 0 : 1
      this.StateSetters[elementId](this.invert)
    }


    /** ============= SHIFT_TABLE ============= **/

    /**
     * TS-PM (Tape Sync(legacy, disabled) - Play Mode) button handler in shift mode
     * Toggles invert mode and writes to pattern memory
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['TS-PM'] = (elementId) => {
      this.invert = this.invert ? 0 : 1
      this.#writeToPattern(17, this.invert)
      this.StateSetters[elementId](this.invert)
    }

    /**
     * ALT button handler in shift mode - same as non-shift mode
     */
    this.#SHIFT_TABLE['ALT'] = () => this.#NO_SHIFT_TABLE['ALT']()

    /**
     * Q (Quantize) button handler - toggles quantization
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['Q'] = (elementId) => {
      this.#quantize = !this.#quantize
      this.StateSetters[elementId](this.#quantize)
    }

    /**
     * CE-TA (Cartridge Enter(leagacy, not used) - Total Accent) button handler in shift mode
     * Toggles total accent mode and switches to accent memory track
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['CE-TA'] = (elementId) => {
      // this.Log('SHIFT TABLE: CE-TA')
      
      // Toggle total accent mode
      this.StateSetters[elementId](state => !state)
      this.GLOBAL_Mk_TA = !this.GLOBAL_Mk_TA

      this.#manageGLCV(this.GLOBAL_Mk_TA, 'TOTAL ACCENT')

      // Manage switching to AC memory track and back
      if (this.GLOBAL_Mk_TA) {
        // Save current instrument and switch to accent track
        this.lastSELECTED_INST = this.SELECTED_INST
        this.SELECTED_INST = 'AC'
        this.setSelInst('AC')
        this.highlightSelectedInstrument('AC')
        this.setMksState()
      } else {
        // Restore previous instrument
        this.SELECTED_INST = this.lastSELECTED_INST
        this.highlightSelectedInstrument()
        this.setSelInst(
          this.GLOBAL_MODE === 'TAP' ?
          'ALL' : this.SELECTED_INST)
        this.setMksState()
      }

      // this.Log('G_MK_TA:', this.GLOBAL_Mk_TA)
    }

    /**
     * SHUFF/FLAM button handler in shift mode
     * Toggles shuffle/flam mode for pattern editing
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['SHUFF /FLAM'] = (elementId) => {
      this.StateSetters[elementId](state => !state)
      this.#shuffleFlam = !this.#shuffleFlam

      this.#manageGLCV(this.#shuffleFlam, elementId)

      // Update UI elements
      this.StateSetters['ils-r'](state => state + 1)
      this.StateSetters['TA-r'](state => state + 1)

      this.#COPY_TO = false
      this.#switchEditKeysLights('COPY', true)
      this.setTempo(this.instSettings['tempo_wheel'][0]);
    }

    /**
     * LAST STEP button handler in shift mode
     * Enables setting the last step of a pattern
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['LAST STEP'] = (elementId) => {
      // When ON, MainKey(s) are used to give the BASE new value
      this.StateSetters[elementId](state => !state) // switches the light
      this.#LAST_STEP = !this.#LAST_STEP

      this.#manageGLCV(this.#LAST_STEP, elementId)

      this.#COPY_TO = false
      this.#switchEditKeysLights('COPY', true)
      this.setTempo(this.instSettings['tempo_wheel'][0]);
    }

    /**
     * CG (Cycle Group) button handler in shift mode
     * Toggles guide mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['CG'] = (elementId) => {
      this.#guide = !this.#guide
      this.StateSetters[elementId+'-reload'](state => state + 1)
    }

    /**
     * SCALE button handler in shift mode
     * Cycles through available scales and updates pattern memory
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['SCALE'] = (elementId) => {
       // Cycle through scales (1-4)
       this.#GLOBAL_SCALE += 1
       if (this.#GLOBAL_SCALE === 5) this.#GLOBAL_SCALE = 1
       this.setSCALELightY(this.#scale_light_Y[this.#GLOBAL_SCALE - 1])
 
       // Show temporary indication of scale change
      //  clearTimeout(this.#scaleOffID)
      //  this.setLCV(elementId)
      //  this.#scaleOffID = setTimeout(
      //    () => {
      //     this.#GLCV ?
      //       this.clearLCVDisplay(this.GLOBAL_LED_CONTROL_VARIABLE()) :
      //       this.clearLCVDisplay('SHIFT')
      //    }, 
      //    1000)
       this.setDisplay(elementId, true)
 
       this.#changeGridForNewBASE()
 
       // Register the new SCALE within the current pattern
       let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]
       patternLocation[11] = this.#GLOBAL_SCALE
    }

    /**
     * TEMPO-STEP button handler in shift mode
     * Switches to STEP mode for pattern editing
     * @param {string} elementId - The ID of the element that triggered the command
     * @param {*} payload - Additional data passed to the handler
     */
    this.#SHIFT_TABLE['TEMPO-STEP'] = (elementId, payload) => {
      // Switch to STEP mode
      this.GLOBAL_MODE = 'STEP'
      this.setStepTap('STEP')
      this.updatePatternAndInstSTEP()
      this.setMksState()
      this.setSelInst(this.SELECTED_INST)
      this.highlightSelectedInstrument()

      // Update UI elements
      this.StateSetters['StepTapKeys'](state => !state)

      // Preserve INST SELECT display if active
      if (this.GLOBAL_LED_CONTROL_VARIABLE() === 'INST SELECT') {
        this.StateSetters['INST SELECT'](true)
        this.setDisplay('GLCV', 'INST SELECT')
      }

      // Enable INST SELECT and Quantize keys in STEP mode
      this.StateSetters['INST SELECT-reload'](state => !state)
      this.StateSetters['Q-reload'](state => !state)
    },

    /**
     * BACK-TAP button handler in shift mode
     * Switches to TAP mode for real-time pattern input
     * @param {string} elementId - The ID of the element that triggered the command
     * @param {*} payload - Additional data passed to the handler
     */
    this.#SHIFT_TABLE['BACK-TAP'] = (elementId, payload) => {
      // Switch to TAP mode
      this.GLOBAL_MODE = 'TAP'
      this.setStepTap('TAP')
      
      // In TAP mode, set SELECTED_INST Display to ALL
      this.setSelInst('ALL')
      this.highlightSelectedInstrument('ALL')

      // Update UI elements
      this.StateSetters['StepTapKeys'](state => !state)

      // Update available buttons in TAP mode
      this.StateSetters['Q-reload'](state => !state)
    },

    /**
     * INST SELECT button handler in shift mode
     * Same as non-shift mode
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['INST SELECT'] = (elementId) => {  
      this.#NO_SHIFT_TABLE['INST SELECT'](elementId)
      this.#COPY_TO = false
      this.#switchEditKeysLights('COPY', true)
      this.setTempo(this.instSettings['tempo_wheel'][0]);
    }
    
    /**
     * CLEAR button handler in shift mode
     * Handles various clearing operations based on context
     */
    this.#SHIFT_TABLE['CLEAR'] = async () => {
      // Clear copy buffer if in copy mode
      if (this.#COPY_TO) {
        if (!this.isBankTable) {
          this.#clearCOPY_TO_BUFFER(false)
        } else {
          this.#clearCOPY_TO_BUFFER(false, true)
          if (this.StateSetters['DCV_lcv'].slice(-1) !== '?') {
            this.setLCV(state => state + '?')
          }
        }
        return
      }

      // Clear last/first step if in LAST STEP mode
      if (this.#GLCV === 'LAST STEP') {
        this.#clearLastFirstStep()
        return
      }
 
      // Clear shuffle/flam if in SHUFF/FLAM mode
      if (this.#GLCV === 'SHUFF /FLAM') {
        this.#clearShufFlam()
        return
      }

      // Handle instrument clearing in INST SELECT mode
      if (this.#GLCV === 'INST SELECT') {
        // this.Log('CLEAR: INST SELECT')
        if (this.isBankTable) {
          // this.Log('CLEAR: INST SELECT: BANK TABLE')
          this.#clearInstrumentAllPreset()
          return
        } else {
          // this.Log('CLEAR: INST SELECT: NOT BANK TABLE')
          this.clearInstrument()
          return
        }
      }

      // Handle bank or pattern clearing
      if (this.isBankTable) {
        this.#clearPresetOrBANK()
        return
      } else {
        await this.clearPattern()
        return
      }
    }

    /**
     * B1 button handler in shift mode
     * Selects bank 1 and updates pattern memory
     * @param {string} elementId - The ID of the element that triggered the command
     */
    this.#SHIFT_TABLE['B1'] = (elementId) => {
      // Update selector code with bank ID
      this.SELECTOR_CODE[0] = elementId
      if (this.TRACK_WRITE) {
        this.#playbackQueue[this.#patternNumber][0] = elementId
      }

      this.#updateCOPYLocation(elementId, 0)

      // Update UI state
      this.StateSetters['BankKeys'](state => !state)
      this.setMksState()
      this.updatePatternAndInstSTEP()

      // Update pattern settings
      this.#updateScaleBase()
      this.#updateSHUFFLEandFLAM()
      this.#changeGridForNewBASE()

      // this.Log('SELECTOR_CODE:', this.SELECTOR_CODE)
    },

    // B2 button uses the same handler as B1 in shift mode
    this.#SHIFT_TABLE['B2'] = (elementId) => {this.#SHIFT_TABLE['B1'](elementId)},
    
    // Track buttons in shift mode call their non-shift handlers with fixed track IDs
    this.#SHIFT_TABLE['T1'] = () => this.#NO_SHIFT_TABLE.T1('T1')
    this.#SHIFT_TABLE['T2'] = () => this.#NO_SHIFT_TABLE.T1('T2')
    this.#SHIFT_TABLE['T3'] = () => this.#NO_SHIFT_TABLE.T1('T3')
    this.#SHIFT_TABLE['T4'] = () => this.#NO_SHIFT_TABLE.T1('T4')
    
    // Pattern Group buttons in shift mode call their non-shift handlers with fixed group IDs
    this.#SHIFT_TABLE['PG1'] = () => this.#NO_SHIFT_TABLE.PG1('PG1')
    this.#SHIFT_TABLE['PG2'] = () => this.#NO_SHIFT_TABLE.PG1('PG2')
    this.#SHIFT_TABLE['PG3'] = () => this.#NO_SHIFT_TABLE.PG1('PG3')
  }

  // ==== MEMORY ==== //
  /**
   * Current pattern selector code [Bank, Track, PatternGroup, PatternNumber]
   * @type {Array}
   */
  SELECTOR_CODE = ['B1', 'T1', 'PG1', 0]
  
  /**
   * Currently selected instrument
   * @type {string}
   */
  SELECTED_INST = 'BD'
  
  /**
   * Last selected instrument (used when toggling between instruments)
   * @type {string}
   */
  lastSELECTED_INST = this.SELECTED_INST
  
  /**
   * Flag indicating if pattern writing is enabled
   * @type {boolean}
   */
  TRACK_WRITE = false

  /**
   * Broadcasts SHIFT state changes to all relevant UI components
   * Updates all button states that change when SHIFT is pressed
   */
  broadcastSHIFTChange () {
    // Main key
    this.StateSetters['CE-TA'+'r'](state => state += 1)

    // Led keys
    this.StateSetters['LAST STEP'+'-reload'](state => state += 1)
    this.StateSetters['SHUFF /FLAM'+'-reload'](state => state += 1)
    this.StateSetters['INST SELECT'+'-reload'](state => state += 1)
    this.StateSetters['Q'+'-reload'](state => state += 1)
    this.StateSetters['SCALE'+'-reload'](state => state += 1)
    this.StateSetters['CLEAR'+'-reload'](state => state += 1)
    this.StateSetters['ALT'+'-reload'](state => state += 1)
    this.StateSetters['T1'+'-reload'](state => state += 1)
    this.StateSetters['T2'+'-reload'](state => state += 1)
    this.StateSetters['T3'+'-reload'](state => state += 1)
    this.StateSetters['T4'+'-reload'](state => state += 1)
    this.StateSetters['PG1'+'-reload'](state => state += 1)
    this.StateSetters['PG2'+'-reload'](state => state += 1)
    this.StateSetters['PG3'+'-reload'](state => state += 1)
    this.StateSetters['B1'+'-reload'](state => state += 1)
    this.StateSetters['B2'+'-reload'](state => state += 1)
    this.StateSetters['TEMPO-STEP'+'-reload'](state => state += 1)
    this.StateSetters['BACK-TAP'+'-reload'](state => state += 1)
    this.StateSetters['EXT'+'-reload'](state => state += 1)
    this.StateSetters['CG'+'-reload'](state => state += 1)
    this.StateSetters['TS-PM'+'-reload'](state => state += 1)
  }

  /**
   * Returns the current state of the shuffle/flam mode
   * @returns {boolean} True if shuffle/flam mode is active
   */
  isShuffleFlam = () => { return this.#shuffleFlam }

  /**
   * Update the display for SELECTED INST
   * In TAP mode this field must be blank and changing INST is not allowed
   */
  setSelInst = () => {}
  
  /**
   * Update the display for SELECTED PATTERN
   */
  setSelPat = () => {}

  /**
   * Currently highlighted pattern ID
   * @type {number}
   * @private
   */
  #highlightedPattern = 0
  
  /**
   * Highlights the selected pattern in the UI
   * @param {number} patternId - The pattern ID to highlight (default: 0)
   * @private
   */
  #highlightSelectedPattern (patternId=0) {
    // this.Log("highlightSelectedPattern: ", patternId)
    this.StateSetters[this.#highlightedPattern+'ssp'](false)
    this.StateSetters[patternId+'ssp'](true)
    this.#highlightedPattern = patternId
  }

  /**
   * Currently highlighted instrument
   * @type {string}
   * @private
   */
  #highlightedInstrument = this.SELECTED_INST
  
  /**
   * Mapping of instrument names to their indices
   * @type {Object}
   * @private
   */
  #instObj = {
    "BD": 0, "SD": 1, "LT": 2, "MT": 3, "HT": 4,
    "RS": 5, "HC": 6, "HHC": 7, "HHO": 14, "CR": 8, "RD": 9 
  }
  
  /**
   * Toggles the bottom highlight bar of the supplied instrument.
   * @param {string} INST - Instrument to highlight (default: current SELECTED_INST)
   */
  highlightSelectedInstrument (INST=this.SELECTED_INST) {
    let inst = this.#instObj[INST]
    // this.Log("highlightSelectedInstrument: ", INST, inst, "remove: ", this.#instObj[this.#highlightedInstrument], "add: ", inst)
    
    // Remove highlight from previous instrument
    let prevInst = document.getElementById(this.#instObj[this.#highlightedInstrument]+"ssi")
    prevInst && prevInst.classList.remove("sel-inst")
    
    // Add highlight to new instrument
    let nowInst = document.getElementById(inst+"ssi")
    nowInst && nowInst.classList.add("sel-inst")
    
    this.#highlightedInstrument = INST
  }
  
  /** 
   * Gets the updated memory slot value based on current mode and instrument
   * 
   * @param {number} elementId - The element ID (step number)
   * @param {string} stepINST - The instrument in STEP mode
   * @param {string} tapINST - The instrument in TAP mode
   * @returns {number} The new state value for the memory slot
   */
  getUpdatedMemorySlot = (elementId, stepINST, tapINST) => {
    let state
    // These idiosyncrasies are inherited from the original hardware/
    // hi-hat closed 'HHC' and hi-hat open 'HHO' sit on the same track,
    // yet have different state values, 0, 1, 2, and 0, 3, 6. 
    switch (this.GLOBAL_MODE) {
      case 'STEP':
        state = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][this.#I[stepINST]][elementId]

        if (this.#COPY_TO) { return state }

        // Handle special case for HHO, otherwise cycle through states
        return stepINST==='HHO' ? (state<3 ? 3 : state + 3)%9 : (state + 1)%3

      case 'TAP':
        // Total Accent is always updated in the STEP mode
        if (stepINST === 'AC') {
          state = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][this.#I[stepINST]][elementId]

          return stepINST==='HHO'?(state<3?3:state + 3)%9 : (state + 1)%3
        }

        state = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][this.#I[tapINST]][this.#beatRunnerCounter]

        // no data input if we have stopped the playback or COPY_TO is set
        if (this.GLOBAL_SSC==='STOP') {
          return state
        }
        if (this.#COPY_TO) { return state }


        return elementId<10 ? // only first 5 MainKey(s) pairs have this
          elementId%2===0 ? (state + 1 )%2 : state<2?2:(state + 2)%4
          :
          tapINST==='HHO' ? (state<3?3:state + 3)%9 : (state + 1)%3
    }

  }
  /**
   * Flag to track if a key is being held down
   * @type {boolean}
   * @private
   */
  #keyLoop = true
 
  /**
   * Stops tracking a held key
   * Used to cancel key hold actions
   */
  stopTrackingHeldKey () {
    this.#keyLoop = false
  }

  /**
   * Returns the current state of the key loop tracking
   * @returns {boolean} Current state of key tracking
   */
  giveKeyLoop() {
    return this.#keyLoop
  }

  /**
   * Action to execute when a key is held down for a specified time
   * @type {Function}
   * @private
   */
  #holdThenExecuteAction = () => {}

  /**
   * Flag indicating if preset name change is in progress
   * @type {boolean}
   */
  isPresetNameChange = false

  /**
   * Flag indicating if bank name change is in progress
   * @type {boolean}
   */
  isBankNameChange = false

  /**
   * Gracefully wraps the `AlertTable` dispatcher.
   * Calling without parameters will close the `AlertTable`. 
   * Calling with no `alert_body` will not let it open. 
   * 
   * @param {string} [alert_body=""] - Formatted string: `OK_label @alert_text`
   * @param {Function} [OK=()=>{}] - Callback for OK action
   * @param {Function} [CANCEL=()=>{}] - Callback for CANCEL action
   * @param {Array} [payload=[]] - Additional payloads, like `.jsx` components
   */
  Alert([alert_body="", OK=()=>{}, CANCEL=()=>{}, payload=[]]=[false]) {
    const alert = this.StateSetters["setAlertTableOn"]
    alert([alert_body, OK, CANCEL, payload])
  }

  /**
   * Execute provided action after the key was held for a specified amount of time.
   * 
   * @param {string} action - Action to execute
   * @param {string} actionAddress - Address of the action callback within StateSetters body
   * @param {number} ms - Time needed to hold the key to invoke an action (milliseconds)
   * @param {number} [precision=100] - Tracking speed in milliseconds
   * 
   * Available actions:
   * - `CPD` - Clear preset data
   * - `SPN` - Save preset name
   * - `SBN` - Save bank name
   * - `CRM` - Clear "reverse" mode in every pattern in the preset
   */
  holdThenExecute(action, actionAddress, ms, precision=100) {
    this.#keyLoop = true
    switch (action) {
      case 'CPM':
        if (!this.TRACK_WRITE) { return }
        this.#holdThenExecuteAction = () => {
          let preset_name = this.PRESETS[this.presetSlotByBank(
            this.currentBank!==this.oldBank?this.oldBank:this.currentBank)][8]
          let RKey = document.getElementById('TS-PM')
          RKey.classList.add('pe-none') // block the default action
          this.Alert([
            `CLEAR @CLEAR DOWN REVERSE FOR EVERY PATTERN IN ${preset_name} ?`,
            (CLEAR) => {
              this.#clearReverseMode()
              RKey.classList.remove('pe-none')
              this.Alert()
            },
            (CANCEL) => {
              RKey.classList.remove('pe-none')
              this.Alert()
            }
          ])
        }
        break
      case 'CPD': 
        this.#holdThenExecuteAction = () => {
          let preset_name = this.PRESETS[this.presetSlotByBank(
            this.currentBank!==this.oldBank?this.oldBank:this.currentBank)][8]
          let CLEARkey = document.getElementById('CLEAR')
          CLEARkey.classList.add('pe-none') // block the default action
          this.Alert([
            `CLEAR @CLEAR DOWN EVERY PATTERN IN ${preset_name} ?`,
            (CLEAR) => {
              this.#clearPreset()
              CLEARkey.classList.remove('pe-none')
              this.Alert()
            },
            (CANCEL) => {
              CLEARkey.classList.remove('pe-none')
              this.Alert()
            }
          ])
        }
        break;
      case 'SPN': 
        this.#holdThenExecuteAction = () => {
          this.StateSetters[actionAddress](state =>!state) }     
        break;
      case 'SBN': 
        this.#holdThenExecuteAction = () => {
          this.StateSetters[actionAddress](state =>!state) }
        break;
    }

    /**
     * Recursive function to track key hold duration
     * @param {number} [timer=0] - Current timer count
     * @private
     */
    const tracking = (timer=0) => {
      this.#keyLoop&&setTimeout(() => {
        if (timer>ms/100) {
          this.#holdThenExecuteAction()
          return
        }
        tracking(timer += 1)
      }, precision)
    }
    tracking()
  }

  /**
   * Clears reverse mode for all patterns in the current preset
   * @private
   */
  #clearReverseMode () {
    let patternLocation = 0
    for (let pattern = 0; pattern < this.#playbackQueue.length; pattern++) {
      patternLocation = this.#getPatternMemoryLocation(this.#playbackQueue[pattern])
      this.#memory[patternLocation][17] = 0
    }
    this.invert = 0
    this.StateSetters['TS-PM'](false)
  }

  /**
   * Clears the first and last step settings for the current pattern
   * @private
   */
  #clearLastFirstStep() {
    this.#clearShufFlam(true)
  }

  /**
   * Clear shuffle or flam out of pattern or preset.
   * 
   * @param {boolean} [fitFLS=false] - If true, clears first and last step settings instead of shuffle/flam
   * @private
   */
  #clearShufFlam(fitFLS=false) {
    const idx1 = fitFLS?12:13 // firstStep:shuffle
    const idx2 = fitFLS?16:14 // lastStep:flam
    const baseOrShuffle = fitFLS?16:0 
    let patternLocation = ""
    let clearX = () => {}
    
    let message = ''
    const upd = () => {
      this.#updateScaleBase(false)
      fitFLS?this.#changeGridForNewBASE():this.#updateSHUFFLEandFLAM()
      this.updatePatternAndInstSTEP() 
    }
    if (!this.isBankTable) {
      const name = this.SELECTOR_CODE[3] + 1
      message = `CLEAR @CLEAR ${fitFLS?'FIRST/LAST STEP':"SHUFFLE & FLAM"} DATA IN PATTERN ${name} ?`
      const sc = this.SELECTOR_CODE
      clearX = () => {
        patternLocation = this.#memory[this.#getPatternMemoryLocation(sc)]
        patternLocation[idx1] = baseOrShuffle 
        patternLocation[idx2] = 0 
        !fitFLS&&patternLocation[15].fill(0) // flammed instruments
        upd()
      }
    } else {
      const location = this.presetSlotByBank(
        this.currentBank!==this.oldBank?this.oldBank:this.currentBank
      )
      const name = this.PRESETS[location][8]
      message = `CLEAR @CLEAR ${fitFLS?'FIRST/LAST STEP':"SHUFFLE & FLAM"} IN ${name} ?`
      clearX = () => {
        for (let pattern = 0; pattern < this.#playbackQueue.length; pattern++) {
          patternLocation = this.#memory[this.#getPatternMemoryLocation(this.#playbackQueue[pattern])]
          patternLocation[idx1] = baseOrShuffle 
          patternLocation[idx2] = 0 
          !fitFLS&&patternLocation[15].fill(0) // flammed instruments
        }
        upd()
      }
    }
    this.Alert(
      [message,
      async (CLEAR) => { clearX(); this.Alert() },
      (CANCEL) => { this.Alert() }]
    )
  }

  /**
   * Clears all patterns in the current preset
   * @private
   */
  #clearPreset () {
    this.#resetBaseScaleOthers()
    let patternLocation = 0
    for (let pattern = 0; pattern < this.#playbackQueue.length; pattern++) {
      patternLocation = this.#getPatternMemoryLocation(this.#playbackQueue[pattern])
      this.clearPattern(patternLocation, true)
    }

    this.updatePatternAndInstSTEP()
    this.#updateScaleBase()
    this.#updateSHUFFLEandFLAM()
    this.#changeGridForNewBASE()
    this.setMksState()

    this.invert = 0
    this.StateSetters['TS-PM'](false)
  }

  /** 
   * Unlike `clearPreset()`, it clears the `playbackQueue` as well and
   * changes the preset's name to `"init"`.
   * @private
   */
  #clearPresetOrBANK () {
    const location = this.presetSlotByBank(
      this.currentBank!==this.oldBank?this.oldBank:this.currentBank
    )
    const name = this.#selectedBank?
    this.getUserBankName(this.#selectedBank)
    :this.PRESETS[location][8]
    this.Alert([
      `CLEAR @CLEAR ${name} ?`,
      async (CLEAR) => {
        this.#resetBaseScaleOthers(true)

        if (this.#selectedBank) {
        // this.Log("CLEARING BANK")
        let start_preset = this.presetSlotByBank(this.#selectedBank, 0)
        for (let preset = start_preset; preset < start_preset + 16; preset++) {
          this.PRESETS[preset] = this.#generateEmptyPreset()
        }
        this.StateSetters['BankTABLEreload'](state => !state)

        this.#selectedBank===this.oldBank&&
          this.#setMemory(this.PRESETS[location], this.PRESETS[location][8]==="init"?true:false)
        } else {
          this.#setMemory(this.#generateEmptyPreset(), true, false)
          this.PRESETS[location][8] = name
          this.StateSetters[this.currentPreset+'r'](state => state + 1)
        }
        this.setLastActive('', true)
        
        localStorage.clear()
        this.Alert()
      }, 
      (CANCEL) => { this.Alert() }
    ])
  }

  /**
   * Clears all instances of the specified instrument across all patterns in the preset
   * 
   * @param {boolean} [bypassAlert=false] - If true, skips confirmation dialog
   * @param {string} [instrument=this.SELECTED_INST] - Instrument to clear
   * @private
   */
  #clearInstrumentAllPreset(bypassAlert=false, instrument=this.SELECTED_INST) {
    if (!bypassAlert) {
      this.Alert([
        `CLEAR @CLEAR ALL ${this.#Iverbose[instrument]} DATA IN ${this.getCurrentPresetName()} ?`,
        (CLEAR) => this.#clearInstrumentAllPreset(true),
        (CANCEL) => this.Alert()
      ])
      return
    }
    for (let pattern = 0; pattern < this.#playbackQueue.length; pattern++) {
      this.clearInstrument(true, instrument, this.#playbackQueue[pattern], true)
    }
    this.updatePatternAndInstSTEP()
    this.setMksState()
    this.Alert()
  }

  /**
   * Clear the instrument track. If called while playing a set of patterns,
   * this function operates in behind-of-time (BOT) mode clearing the instrument 
   * track from the pattern on which it was called earlier.
   * 
   * @param {boolean} [bypassAlert=false] - If true, skips confirmation dialog
   * @param {string} [instrument=this.SELECTED_INST] - Instrument to clear
   * @param {Array} [selectorCode=this.SELECTOR_CODE] - Pattern selector code
   * @param {boolean} [bypassUpdate=false] - If true, skips UI updates
   */
  clearInstrument (bypassAlert=false, 
    instrument=this.SELECTED_INST, selectorCode=this.SELECTOR_CODE, bypassUpdate=false) {
    // Capture instrument and selectorCode 
    let _inst = instrument
    let _sc = selectorCode

    if (!bypassAlert) {
      this.Alert([
        `CLEAR @CLEAR ${this.#Iverbose[_inst]} OF PATTERN ${_sc[3]+1} ?`,
        (CLEAR) => this.clearInstrument(true, _inst, _sc),
        (CANCEL) => this.Alert()
      ])
      return
    }
    // (1) Clear the current instrument track
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(_sc)]
    switch (_inst) {
      case 'HHC' : {
        for (let i=0; i<16; i++) {
          if (patternLocation[this.#I[_inst]][i] <= 2) {
            patternLocation[this.#I[_inst]][i] = 0
          }
        } break
      }
      case 'HHO' : { 
        for (let i=0; i<16; i++) {
          if (patternLocation[this.#I[_inst]][i] >= 3) {
            patternLocation[this.#I[_inst]][i] = 0
          }
        } break
      }
      default: {
        for (let i=0; i<16; i++) {
          patternLocation[this.#I[_inst]][i] = 0
        }
      }
    }
    
    // (2) update instrument labels and Mk(s)
    if (!bypassUpdate) {
      this.updatePatternAndInstSTEP()
      this.setMksState()
      this.Alert()
    }
    
  }

  /**
   * Clear the pattern off the instruments data.
   * 
   * @param {number} [patternIdx=undefined] - Pattern's memory index
   * @param {boolean} [bypassAlert=false] - If true, skips confirmation dialog
   * @param {Array} [selectorCODE=this.SELECTOR_CODE] - Pattern selector code
   * @returns {Promise} - Resolves when clearing is complete
   */
  async clearPattern (patternIdx=undefined, bypassAlert=false, selectorCODE=this.SELECTOR_CODE) {
    return new Promise(
      (resolve) => {
        let _sc = selectorCODE
        if (!bypassAlert) {
          this.Alert([
            `CLEAR @CLEAR PATTERN ${_sc[3]+1} ?`,
            async (CLEAR) => await this.clearPattern(undefined, true, _sc),
            (CANCEL) => this.Alert()
          ])
          return
        }
        // (1) Clear the selected pattern
        let patternLocation = this.#memory[
          patternIdx!==undefined?patternIdx:this.#getPatternMemoryLocation(_sc)]
    
        // this.Log('CLEAR PATTERN: patternIdx', patternIdx)
        for (let i=0; i<11; i++) {
          patternLocation[i].fill(0)
        }
    
        this.#resetBaseScaleOthers()
        patternLocation[12] = this.BASE
        patternLocation[11] = this.#GLOBAL_SCALE
        patternLocation[13] = this.#shuffleFactor
        patternLocation[14] = this.#flamFactor
        patternLocation[15].fill(0) // flammed instruments
        patternLocation[16] = this.firstBeat
        patternLocation[17] = this.invert
    
        // (2) Update labels and MainKeys if patternIdx is not given,
        // otherwise the function is called by clearPreset()
        // and will be updated there.
        if (patternIdx === undefined) {
          this.updatePatternAndInstSTEP()
          this.setMksState()
          this.#fadeOutMainKeysForNewBASE()
          this.Alert()
        }
      }
    )
  }

  /** 
   * Hosts all the setState setter of any component put inside.
   * 
   * Indexed reservation:
   * - MainKeys (0, 15)
   * - PatternLabels (16, 31)
   * - InstrumentLabels (32, 42)
   * - MainKeys general reload (43, 58)
   * - Swing and Flam indication over PatternLabels (59, 66)
   * - Open hi-hat is a string field .7O, not an index 70!
   * 
   * The rest entries are method fields.
   * @type {Array}
   */
  StateSetters = []

  /** 
   * Updates every MainKey's led-light with a new state drawn from the memory of the current pattern/measure
   * @returns {boolean} - Always returns true
   */
  setMksState () {
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]
    
    for (let i=0; i<16; i++) {
      this.StateSetters[i](patternLocation[this.#I[this.SELECTED_INST]][i])
    }

    return true
  }

  /**
   * Changes the currently selected instrument
   * 
   * @param {string} INST - Instrument code to select
   * @private
   */
  #changeInstrument (INST) {
    this.SELECTED_INST = INST
    // this.Log('SELECTED_INST: =>', this.SELECTED_INST)
    this.setSelInst(INST)
    this.highlightSelectedInstrument(INST)
    this.setMksState() 
  }

  /** 
   * Search the current Pattern Group for patterns 
   * and instruments that contain notes in them and collect the result into `collectPatternsForPreset` variable.
   * 
   * @returns {Object} - Object mapping pattern indices to arrays of instrument indices
   * @private
   */
  #checkPatternAndInstSTEP = () => {
    const pa_inst = {};
    
    // for every pattern
    for (let pa = 0; pa < 16; pa++) {
      const patternLocation = this.#getPatternGroupLocation(this.SELECTOR_CODE) + pa;
      const pattern = this.#memory[patternLocation];
      
      // Check if user has changed first or last beat
      const first_last_beat_present = pattern[12] < 16 || pattern[16] > 0;
      
      // Store pattern template if first/last beat settings were changed
      if (first_last_beat_present) {
        this.#collectPatternsForPreset.set(patternLocation, pattern);
      }
      
      // Find instruments with data in this pattern
      const activeInstruments = [];
      
      for (let i = 0; i < 11; i++) {
        const instrument = pattern[i];
        
        // Check if any step in this instrument has data
        // Using some() instead of a for loop with break for cleaner code
        if (instrument.some(step => step !== 0)) {
          activeInstruments.push(i);
        }
      }
      
      // Store pattern data or remove it from collection
      if (activeInstruments.length > 0) {
        pa_inst[pa] = activeInstruments;
        this.#collectPatternsForPreset.set(patternLocation, pattern);
      } else if (!first_last_beat_present) {
        this.#collectPatternsForPreset.delete(patternLocation);
      }
    }
    
    return pa_inst;
  }

  /**
   * Number of available pattern slots
   * @type {number}
   * @private
   */
  #availablePatterns = 384

  /**
   * ID for available pattern offset
   * @type {*}
   * @private
   */
  #availablePatternOffID

  /**
   * Map to collect patterns we want to be saved in the preset
   * @type {Map}
   * @private
   */
  #collectPatternsForPreset = new Map()

  /** 
   * Update Pattern and Instrument UI to reflect whether they
   * have any notes in them
   */
  updatePatternAndInstSTEP = () => {
    // Get patterns with active instruments
    const pa_inst = this.#checkPatternAndInstSTEP();
    
    // Update available patterns count
    this.#availablePatterns = 384 - Object.keys(pa_inst).length;

    // Get flammed instruments for current pattern
    const flammedINST = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][15];
    
    // Update pattern UI indicators (16-31)
    for (let pa = 16; pa < 32; pa++) {
      const patternIndex = pa - 16;
      // Set pattern label to true if it has data, false otherwise
      // this.Log('updatePAI:setter idx: ' + (pa_inst[patternIndex] ? 'true' : 'false'), pa);
      this.StateSetters[pa](!!pa_inst[patternIndex]);
      
      // Only process instrument indicators for patterns 0-10
      if (patternIndex <= 10) {
        // Handle instrument indicators
        if (patternIndex < 10) {
          // Special case for index 7 (hi-hat closed/open)
          if (patternIndex === 7) {
            const flamStatus = flammedINST[10 - patternIndex];
            
            switch (flamStatus) {
              case 0:
                this.StateSetters[patternIndex+32][1](false);
                this.StateSetters[patternIndex+'O'][1](false);
                break;
              case 1:
                this.StateSetters[patternIndex+32][1](1);
                this.StateSetters[patternIndex+'O'][1](false);
                break;
              case 2:
                this.StateSetters[patternIndex+32][1](false);
                this.StateSetters[patternIndex+'O'][1](2);
                break;
              case 3:
                this.StateSetters[patternIndex+32][1](1);
                this.StateSetters[patternIndex+'O'][1](2);
                break;
            }
          } else {
            // Normal case for other instruments
            this.StateSetters[patternIndex+32][1](flammedINST[10 - patternIndex] || false);
          }
        }
        
        // Update instrument activity indicators for current pattern
        const currentSelector = this.SELECTOR_CODE[3];
        const activeInstruments = pa_inst[currentSelector];
        
        // Set indicator based on whether this instrument has data in current pattern
        const hasActiveInstruments = activeInstruments && activeInstruments.includes(patternIndex);
        this.StateSetters[-patternIndex+42][0](hasActiveInstruments || false);
      }
    }
  }

  /**
   * Writes flam status for a specific instrument
   * 
   * @param {number} idx - Instrument index
   * @param {number} isFlammed - Flam status value
   */
  writeFlammedINST (idx, isFlammed) {
    // this.Log('writeFlammed', idx, isFlammed)
    // 10 -idx aligns to #I's layout
    this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][15][10 - idx] = isFlammed
    // this.Log('flammedINST', this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][15], isFlammed)
  }

  /**
   * Write SCALE||BASE||SHUFFLE||FLAM into the pattern 
   * 
   * @param {*} variable variable idx location
   * @param {*} payload 
   */
  /**
   * Writes a value to a specific variable in the current pattern
   * 
   * @param {number} variable - Index of the variable to write to in the pattern memory
   * @param {*} payload - Value to write to the pattern memory
   * @private
   */
  #writeToPattern (variable, payload) {
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]

    patternLocation[variable] = payload
  }

  /**
   * Changes the currently played or selected pattern to a new one
   * Updates all relevant UI elements and pattern settings
   * 
   * @param {number} patternId - Pattern ID from MainKeys (0-15)
   * @param {Array} [selectorCode=undefined] - Optional selector code to use instead of patternId
   * @param {boolean} [instantDisplayUpdate=true] - Whether to immediately update the LED display
   */
  changePattern (patternId, selectorCode=undefined, instantDisplayUpdate=true) {
    if (selectorCode) {
      // Use the provided selector code
      this.SELECTOR_CODE = selectorCode.slice()

      // Update relevant LED keys
      this.StateSetters['TrackKeys'](state => !state)
      this.StateSetters['PatternGroupKeys'](state => !state)
      this.TRACK_WRITE&&this.StateSetters['BankKeys'](state => !state)

    } else {
      // Update only the pattern number in the selector code
      this.SELECTOR_CODE[3] = patternId
      this.#playbackQueue[this.#patternNumber][3] = patternId
      if (this.#patternNumber===0) {
        this.#playbackQueue[0] = this.SELECTOR_CODE.slice()
      }
    }

    // Update the queue if we're changing the pattern
    if (this.#playbackQueue.length===1){
      this.#playbackQueue[0] = this.SELECTOR_CODE.slice()
    }

    // Update display and UI elements
    instantDisplayUpdate&&this.setSelPat(patternId + 1)
    this.#highlightSelectedPattern(patternId)
    this.setMksState()
    this.updatePatternAndInstSTEP()
    this.#updateScaleBase(false)
    this.#updateSHUFFLEandFLAM()
    this.#updateInvert()
    this.#changeGridForNewBASE()

    // Ensure instrument highlighting is updated after a short delay
    setTimeout(() => this.highlightSelectedInstrument(), 10)
  }

  /** Flag indicating if mouse is currently pressed down */
  isMouseDown = false
  
  /** Array to store timeouts for MainKey click handlers */
  #handleClickMkTimeOut = []

  /**
   * Handles click events for MainKeys
   * 
   * @param {string} keyId - The ID of the MainKey element
   */
  handleClickMk (keyId) {
    // this.Log("handleClickMk")
    this.#handleClickMkTimeOut.length = 0
    const Mk = document.getElementById(keyId)
    // Ensure click is instant when pressed, for both onClick and mouseDown events
    this.isMouseDown = true
    Mk.click()
    this.isMouseDown = false
    // Add visual feedback
    Mk.classList.add('glow-red')
    this.#handleClickMkTimeOut.push(setTimeout(() => {
      Mk.classList.remove('glow-red')
    }, 100))
  }

  /** Stores the IDs of the shuffle and flam UI elements */
  #shuffleFlamPair = [1+58, 9+58]
  
  /**
   * Main handler for MainKey interactions
   * Processes clicks on MainKeys based on current mode and state
   * 
   * @param {number|string} elementId - ID of the clicked MainKey
   * @param {string} INST - Current instrument
   * @param {number} payload - Value to store (typically velocity/accent)
   * @param {boolean} altKey - Whether Alt key is pressed during click
   */
  consumeMk = (elementId, INST, payload, altKey) => {
    // this.Log("consumeMk:", elementId, INST, payload, altKey)

    // Handle special modes that aren't related to pattern editing
    if (this.#GLCV !== 'INST SELECT') {
      
      // Select bank with Alt key in bank table mode
      if (this.isBankTable && this.isAltKey()) {
        const bankId = elementId>2?'UBa'+(elementId/2-2):'FBa'+elementId/2
        document.getElementById(bankId).click()
        this.#altKey = false
        return
      }

      // Play preset on keyboard in bank table mode
      if (this.isBankTable && !this.TRACK_WRITE) {
        const presetSlot = elementId%2==0?Math.ceil(elementId/2):Math.ceil(elementId/2)+7

        document.getElementById('P'+presetSlot).click()
        return
      }

      // Start pattern playback from a specific position
      // Notes:
      // 1. !this.TRACK_WRITE prevents entering notes during playback
      // 2. Patterns sliced with first beat aren't "modulo clear" and can trigger cells outside pattern
      //    Patterns sliced with last beat are "modulo clear" - outside cells trigger inside the slice
      if (!this.isBankTable && !this.isQueueTable && !this.TRACK_WRITE) {
        this.#beatRunnerCounter = !this.invert ? elementId-1 : elementId+1
        return
      }
    }
    
    // Handle pattern selection in queue table mode with Alt key
    if (this.TRACK_WRITE && (altKey || this.#altKey) && this.isQueueTable && !this.#LAST_STEP) {
      // this.Log('Changing pattern to:', elementId)
      this.changePattern(elementId)
      this.StateSetters['QT'+this.#patternNumber](state => !state)
      this.setPatternLocation(this.SELECTOR_CODE)
      return
    }
    
    // Handle instrument selection
    if ((this.#GLCV === 'INST SELECT' && !this.#COPY_TO) || 
      (altKey || this.#altKey) && !this.#LAST_STEP && this.#GLCV !== 'TOTAL ACCENT') {
      // Play sound in TAP mode
      this.GLOBAL_MODE === 'TAP' && this.#soundTABLE[this.#I[INST]](
        this.#audioCtx.currentTime, elementId%2 + 1, 0.8, undefined, elementId)
      this.#changeInstrument(INST)
      return
    }

    // Handle copy buffer operations
    if (this.#COPY_TO && this.TRACK_WRITE && !this.isBankTable) {
      let copiedPattern = this.SELECTOR_CODE.slice()
      copiedPattern[3] = elementId

      // Delete element if it exists, otherwise add it to the buffer
      while (!this.#COPY_TO_BUFFER.delete(elementId)) {
        this.#COPY_TO_BUFFER.set(elementId, copiedPattern)
        this.StateSetters[elementId+'cm'](true)
        return
      }

      this.StateSetters[elementId+'cm'](false)
      return
    } else if (this.#COPY_TO && this.TRACK_WRITE && this.isBankTable && !this.#bankToBeCopyFrom) {

      /**
       * add preset slots to the COPY_TO_BUFFER
       */
      const presetSlot = elementId%2==0?Math.ceil(elementId/2):Math.ceil(elementId/2)+7
      const presetLocation = this.presetSlotByBank(
        this.currentBank, presetSlot
      )

      while (!this.#COPY_TO_BUFFER.delete(presetSlot)) {
        this.#COPY_TO_BUFFER.set(presetSlot, presetLocation)

        this.StateSetters['PRa'+presetSlot+'cm'](true)
        if (this.StateSetters['DCV_lcv'].slice(-1) === '?' && this.#selectedBank && this.#selectedBank.slice(0, 2) === 'UB') {
          this.setLCV(state => state.slice(0, -1))
        }
        return
      }

      this.StateSetters['PRa'+presetSlot+'cm'](false)
      if (this.#COPY_TO_BUFFER.size === 0) {
        if (this.StateSetters['DCV_lcv'].slice(-1) !== '?') {
          this.setLCV(state => state + '?')
        }
      }
      return
    }

    // Handle shuffle and flam adjustments
    if (this.#shuffleFlam) {
      /* Set shuffle factor with first 7 MainKeys */
      if (elementId < 7) {
        this.#shuffleFactor = elementId/this.#swingFactor
        this.StateSetters[this.#shuffleFlamPair[0]](false) 
        this.StateSetters[1+ elementId+58](true)
        this.#shuffleFlamPair[0] = 1+ elementId+58 
        if (this.TRACK_WRITE) {
          this.#writeToPattern(13, this.#shuffleFactor)
        }
      /* Set flam factor with last 7 MainKeys */
      } else if (elementId > 7) {
        this.#flamFactor = (elementId-8)/this.#flamSpread
        this.StateSetters[this.#shuffleFlamPair[1]](false) 
        this.StateSetters[1+ elementId+58](true)
        this.#shuffleFlamPair[1] = 1+ elementId+58 
        if (this.TRACK_WRITE) {
          this.#writeToPattern(14, this.#flamFactor)
        }
      }
      
      this.TRACK_WRITE && this.setMksState() 
      return
    }

    // Handle last step (pattern length) adjustments
    if (this.#LAST_STEP) {
      if (altKey || this.#altKey) {
        // Set first beat with Alt key
        if (elementId >= this.BASE) {
          return
        }
        // this.Log('WRITE FIRST BEAT:', elementId)
        this.firstBeat = elementId
        this.#writeToPattern(16, elementId)
      } else {
        // Set last beat (pattern length)
        if (elementId < this.firstBeat) {
          return
        } 
        this.BASE = elementId+1
        if (this.TRACK_WRITE) {
          // this.Log('WRITE LAST BEAT:', elementId)
          this.#writeToPattern(12, this.BASE)
        }
      }

      // this.Log('consumeMK:LAST STEP:new BASE:', this.BASE)
      this.TRACK_WRITE && this.setMksState() 
      this.#changeGridForNewBASE()
      return
    }

    // Handle queue table operations
    if (this.isQueueTable && !this.TRACK_WRITE && !this.#instSelect) {
      if (this.#playbackQueue.length < 120) {
        let patternAddress = this.SELECTOR_CODE.slice()
        patternAddress[3] = elementId

        this.#playbackQueue.push(patternAddress)
        
        // Make pattern visible on QueueTable
        this.StateSetters['QT'+(this.#playbackQueue.length-1)](state => state += 1)

        // Update LED display
        this.StateSetters['setLastPat'](elementId+1)
        this.StateSetters['setQueueLen'](this.#playbackQueue.length)

        // Turn on the LAST STEP key when queue has multiple patterns
        this.#playbackQueue.length > 1
          && this.StateSetters['LAST STEP-reload'](state => !state)

      }
      return
    }

    // Handle instrument selection in STEP mode
    if (this.#instSelect && this.GLOBAL_MODE === 'STEP') {
      this.#changeInstrument(INST)
      return
    }

    // Get current pattern data
    let patternLocation = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]
    
    // Process based on current global mode
    switch (this.GLOBAL_MODE) {
      // TAP MODE - Handles real-time input
      case 'TAP': 
        // Handle accent track separately
        if (this.SELECTED_INST === 'AC') {
          patternLocation[this.#I[this.SELECTED_INST]][elementId] = payload
          break
        }

        if (this.TRACK_WRITE) {
          // Record note at current beat position if sequencer is running
          if (this.GLOBAL_SSC !== 'STOP') {
            patternLocation[this.#I[INST]][
              this.#beatLocation()] = payload
          }
          
          // Play sound (elementId%2 + 1 computes accent based on key pressed)
          this.#soundTABLE[this.#I[INST]](
            this.#audioCtx.currentTime, elementId%2 + 1, 0.8, undefined, elementId)
        }
        break

      // STEP MODE (default) - Direct pattern editing
      default:
        if (this.TRACK_WRITE) {
          patternLocation[this.#I[this.SELECTED_INST]][elementId] = payload
        }
    }
  }

  /** 
   * Flag that controls whether MainKeys update patterns or select patterns to copy
   * When true, prevents MainKeys from updating memories but allows selecting patterns to copy
   */
  #COPY_TO = false
  
  /**
   * Resets the COPY_TO flag and updates UI accordingly
   */
  setCOPY_TO_false = () => { 
    this.#COPY_TO = false 
    this.#switchEditKeysLights('COPY', true)
    this.isBankTable && this.#clearCOPY_TO_BUFFER()
  }
  
  /** Map that stores patterns selected for copying */
  #COPY_TO_BUFFER = new Map()

  /** Flag for quantization of recorded notes */
  #quantize = false
  
  /**
   * Calculates the beat position for recording notes
   * Applies quantization if enabled
   * 
   * @returns {number} The beat position to record at
   */
  #beatLocation() {
    if (!this.#quantize) return this.#beatRunnerCounter
    else if (this.#beatRunnerCounter < 2) return 0
    else if (this.#beatRunnerCounter < 4) return 2
    else if (this.#beatRunnerCounter < 6) return 4
    else if (this.#beatRunnerCounter < 8) return 6
    else if (this.#beatRunnerCounter < 10) return 8
    else if (this.#beatRunnerCounter < 12) return 10
    else if (this.#beatRunnerCounter < 14) return 12
    else if (this.#beatRunnerCounter < 16) return 14
  }

  /** Tracks the previously used edit key for UI state management */
  #prevUsedEditKey = 'COPY'
  
  /**
   * Controls the UI state of edit command buttons
   * 
   * @param {string} command_name - Name of the edit command
   * @param {boolean} turnOff - If true, turns off the specified key instead of switching to it
   */
  #switchEditKeysLights (command_name, turnOff = false) {
    if (!turnOff) {
      this.StateSetters[command_name](true)
      this.#prevUsedEditKey !== command_name &&
        this.StateSetters[this.#prevUsedEditKey](false)
      this.#prevUsedEditKey = command_name
      return
    }

    // Turn the editKey's light OFF
    this.StateSetters[command_name](false)
  }

  /** Buffer for storing copied pattern data */
  #COPY_BUFFER = [0]
  
  /** Buffer for storing copied preset data */
  #COPY_BUFFER_PRESET = []
  
  /**
   * Copies the current instrument's data to the copy buffer
   * 
   * @param {Array} SELECTOR_CODE - Pattern selector code
   * @param {Array} COPY_BUFFER - Buffer to store copied data
   */
  #copyInstrument (SELECTOR_CODE, COPY_BUFFER) {
    let currentPattern = this.#memory[this.#getPatternMemoryLocation(SELECTOR_CODE)]

    COPY_BUFFER.length = 0
    
    // Copy instrument data
    for (let i=0; i<16; i++) {
      COPY_BUFFER[i] = currentPattern[this.#I[this.SELECTED_INST]][i]
    }

    // Copy flam data for the instrument
    COPY_BUFFER.flammedINST = currentPattern[15][this.#I[this.SELECTED_INST]]
    // this.Log('instrumentCopied', this.#COPY_BUFFER)
  }

  /**
   * Copies an entire pattern to the copy buffer
   * 
   * @param {Array} SELECTOR_CODE - Pattern selector code
   * @param {Array} COPY_BUFFER - Buffer to store copied data
   */
  #copyPattern (SELECTOR_CODE, COPY_BUFFER) {
    let currentPattern = this.#memory[this.#getPatternMemoryLocation(SELECTOR_CODE)]

    COPY_BUFFER.length = 0

    // Copy all instrument data
    for (let instrument=0; instrument<11; instrument++) {
      COPY_BUFFER[instrument] = []
      for (let memory=0; memory<16; memory++) {
        COPY_BUFFER[instrument][memory] = currentPattern[instrument][memory]
      }
    }
    
    // Copy pattern settings
    COPY_BUFFER[11] = currentPattern[11]  // Scale
    COPY_BUFFER[13] = currentPattern[13]  // Shuffle
    COPY_BUFFER[14] = currentPattern[14]  // Flam
    COPY_BUFFER[12] = currentPattern[12]  // Last step
    COPY_BUFFER[15] = currentPattern[15].slice()  // Flammed instruments
    COPY_BUFFER[16] = currentPattern[16]  // First beat
    COPY_BUFFER[17] = currentPattern[17]  // Invert
  }

  /**
   * Copies patterns from the queue table to the copy buffer
   */
  #copyPatterns () {
    while (this.isQueueTable && !this.TRACK_WRITE) {
      this.#COPY_BUFFER.length = 0
      for (let i=this.#patternNumber; i<this.#playbackQueue.length; i++){
        this.#COPY_BUFFER[i-this.#patternNumber] = this.#playbackQueue[i].slice()
      }
      return
    }
  }

  /**
   * Pastes patterns from the copy buffer to the queue table
   */
  #pastePatterns () {
    // Validate copy buffer format
    if (!Array.isArray(this.#COPY_BUFFER[0])) return
    if (this.#COPY_BUFFER[0].length !== 4) return

    while (!this.TRACK_WRITE) {
      // Prevent inserting more than 120 patterns (QT's max capacity)
      let stopIdx = this.#COPY_BUFFER.length + this.#patternNumber + 1 <= 120 ?
        this.#COPY_BUFFER.length + this.#patternNumber + 1 : 120
      
      for (let i=this.#patternNumber+1; i<stopIdx; i++) {
        this.#playbackQueue[i] = this.#COPY_BUFFER[i-(this.#patternNumber+1)].slice()
        this.StateSetters['QT'+i](state => state += 1)
      }
      
      // Update display with new data
      this.StateSetters['setLastPat'](this.#playbackQueue[this.#playbackQueue.length-1][3]+1)
      this.StateSetters['setQueueLen'](this.#playbackQueue.length)
      return 
    }
  }

  /**
   * Deletes patterns from the queue table starting at current position
   */
  #deletePatterns () {
    while (!this.TRACK_WRITE) {
      for (let i=this.#patternNumber; i<this.#playbackQueue.length; i++) {
        // Switch off patterns from the QueueTable
        this.StateSetters['QT'+i](state => state += 1)
      }
      
      // Cut the playbackQueue
      this.#playbackQueue.length = this.#patternNumber+1

      // Update display with new data
      this.StateSetters['setLastPat'](this.#playbackQueue[this.#playbackQueue.length-1][3]+1)
      this.StateSetters['setQueueLen'](this.#playbackQueue.length)
      return
    }
  }

  /**
   * Pastes instrument data from copy buffer to the current pattern
   * 
   * @param {Array} SELECTOR_CODE - Pattern selector code
   * @param {Array} COPY_BUFFER - Buffer containing copied data
   */
  #pasteInstrument (SELECTOR_CODE, COPY_BUFFER) {
    // Validate copy buffer format for instrument data
    if (COPY_BUFFER.length !== 16) return
    if (Array.isArray(COPY_BUFFER[0])) return

    let patternLocation = this.#memory[this.#getPatternMemoryLocation(SELECTOR_CODE)]
    
    // Copy instrument data to pattern
    for (let i=0; i<16; i++) {
      patternLocation[this.#I[this.SELECTED_INST]][i] = COPY_BUFFER[i]
    }

    // Copy flam data for the instrument
    patternLocation[15][this.#I[this.SELECTED_INST]] = COPY_BUFFER.flammedINST
  }

  /**
   * Pastes pattern data from copy buffer to the current pattern
   * 
   * @param {Array} SELECTOR_CODE - Pattern selector code
   * @param {Array} COPY_BUFFER - Buffer containing copied data
   */
  #pastePattern (SELECTOR_CODE, COPY_BUFFER) {
    // Validate copy buffer format for pattern data
    if (COPY_BUFFER.length !== 18) return
    if (COPY_BUFFER[0].length !== 16) return 

    // this.Log('pastePattern')

    let patternLocation = this.#memory[this.#getPatternMemoryLocation(SELECTOR_CODE)]
    
    // Copy all instrument data
    for (let i=0; i<11; i++) {
      for (let j=0; j<16; j++) {
        patternLocation[i][j] = COPY_BUFFER[i][j]
      }
    }

    // Copy pattern settings
    patternLocation[11] = COPY_BUFFER[11]  // Scale
    patternLocation[13] = COPY_BUFFER[13]  // Shuffle
    patternLocation[14] = COPY_BUFFER[14]  // Flam
    patternLocation[12] = COPY_BUFFER[12]  // Last step
    patternLocation[15] = COPY_BUFFER[15].slice()  // Flammed instruments
    patternLocation[16] = COPY_BUFFER[16]  // First beat
    patternLocation[17] = COPY_BUFFER[17]  // Invert
  }

  /**
   * Deletes the selected pattern from the queue table
   * If the queue has only one pattern, it won't be deleted
   * Has immediate effect without waiting for pattern to finish playing
   */
  #deletePattern () {
    while (this.#playbackQueue.length > 1) {
      let fringe = this.#patternNumber

      // this.Log('deletePattern:w1:fringe:', fringe, this.#playbackQueue[fringe])
      
      // Shift all patterns down to fill the gap
      while (this.#playbackQueue[fringe]) {
        this.#playbackQueue[fringe] = this.#playbackQueue[fringe+1]
        this.StateSetters['QT'+fringe](state => state+=1)
        fringe += 1
      }

      if (fringe !== this.#patternNumber) {
        // this.Log('deletePattern')        

        this.#playbackQueue.pop()
        // this.Log('   ...playbackQ:', this.#playbackQueue)
        // this.Log('   ...patternNumber:', this.#patternNumber)

        // If we deleted the pattern we were on, move back one
        if (!this.#playbackQueue[this.#patternNumber])
          this.#patternNumber -= 1

        this.switchQTSlot(this.#patternNumber)
        this.changePattern(this.#playbackQueue[this.#patternNumber][3], this.#playbackQueue[this.#patternNumber])

        // Update queue table and LED display
        this.StateSetters['setQueueLen'](this.#playbackQueue.length)
        this.StateSetters['setLastPat'](this.#playbackQueue[
          this.#playbackQueue.length-1][3]+1)
        // this.Log('playbackQueue:', this.#playbackQueue)
      } 
      return
    }
  }

  /**
   * Calculates the absolute position of a preset within the PRESETS table based on bank and preset number
   * @param {string} bank - The bank identifier (e.g., 'FBa0', 'UBa1'). Defaults to currentBank
   * @param {string|number} preset - The preset number within the bank. Defaults to currentPreset slice from index 3
   * @returns {number} The absolute position of the preset in the PRESETS table
   */
  presetSlotByBank = (bank=this.currentBank, preset=this.currentPreset.slice(3)) => {
    let currentPresetNum = Number(preset)
    switch (bank) {
      case 'FBa0': return currentPresetNum
      case 'FBa1': return currentPresetNum + 16
      case 'UBa0': return currentPresetNum + 32
      case 'UBa1': return currentPresetNum + 48
      case 'UBa2': return currentPresetNum + 64
      case 'UBa3': return currentPresetNum + 80
      case 'UBa4': return currentPresetNum + 96
      case 'UBa5': return currentPresetNum + 112
    }
  }

  /**
   * Retrieves the name of the current preset
   * @returns {string} The name of the current preset
   */
  getCurrentPresetName = () => {
    return this.PRESETS[this.presetSlotByBank(this.oldBank)][8]
  }

  /**
   * Saves the current session state to localStorage
   * Stores preset data, UI preferences, and current selections
   */
  writeLocalStorage () {
    let localSessionToStore = stringify(
      this.#collectPreset(this.oldBank), {
        detectUtcTimestamps: false, fullPrecisionFloats: true
    })

    localStorage.setItem('session', localSessionToStore)
    localStorage.setItem('law', this.lastActiveWheel)
    localStorage.setItem('currentBank', this.oldBank)
    localStorage.setItem('currentBankUserName', this.getUserBankName(this.oldBank))
    localStorage.setItem('currentPreset', this.currentPreset)
    localStorage.setItem('currentLocation', this.presetSlotByBank(
      this.oldBank))
    localStorage.setItem('currentBodyColor', this.currentBodyColor)
    localStorage.setItem('hueRangeVar', this.hueRangeVar)
    localStorage.setItem('currentFontColor', this.currentFontColor)

  }

  /**
   * Generates a filename with the .tr909preset extension
   * @param {string} filename - Base filename without extension
   * @returns {string} Filename with .tr909preset extension
   */
  #get_currentPreset_fileExtention = (filename) => {
    return filename + ".tr909preset"
  }

  /**
   * Generates a filename with the .tr909bank extension based on bank type
   * @param {string} selectedBank - Bank identifier (e.g., 'FBa0', 'UBa1')
   * @returns {string} Filename with .tr909bank extension
   */
  #get_currentBank_fileExtention = (selectedBank) => {
    if (selectedBank[0] === "F") {
      return this.banks[selectedBank.slice(3)] + ".tr909bank"
    }
    return this.banks[Number(selectedBank.slice(3)) + 2] + ".tr909bank"
    
  }

  /**
   * Saves a blob to a file and triggers download
   * @param {Blob} blob - The data to save
   * @param {string} name - The filename to use for the download
   * @returns {Promise<void>}
   */
  async #saveFile (blob, name='my_pattern.tr909preset') {
    const a = document.createElement('a');
    a.download = name;
    a.href = URL.createObjectURL(blob);
    // this.Log(a)
    a.addEventListener('click', (e) => {
      setTimeout(() => URL.revokeObjectURL(a.href), 30 * 1000);
    });
    a.click();
  };

  /**
   * Iterator for ReadableStream that works in Safari
   * Safari doesn't support native iteration over ReadableStream
   * @param {ReadableStream} stream - The stream to iterate over
   * @yields {Uint8Array} Chunks of data from the stream
   */
  async * #readableStreamIter(stream) {
    const reader = stream.getReader()
    try {
      let result = await reader.read()
      while(!result.done) {
        yield result.value
        result = await reader.read()
      }
    } finally {
      reader.releaseLock()
    }
  }
  
  /**
   * Compresses an object to a gzipped blob
   * @param {Object} obj - The object to compress
   * @returns {Promise<Blob>} A compressed blob
   */
  async #zipObjectToBlob(obj) {
    const string = stringify(obj, { detectUtcTimestamps: false, fullPrecisionFloats: true })
    const stream = new Blob([string]).stream()
    const zippedStream = stream.pipeThrough(
      new CompressionStream("gzip")
    )
    const chunks = []
    const iter = this.#readableStreamIter(zippedStream)
    for await (const chunk of iter) {
      chunks.push(chunk)
    }
    return new Blob(chunks)
  }

  /**
   * Decompresses a gzipped blob to an object
   * @param {Blob} obj - The compressed blob
   * @returns {Promise<Blob>} The decompressed blob (empty if decompression fails)
   */
  async #unzipObject(obj) {
    const stream = new Blob([obj]).stream();
    try {
      const unzippedStream = stream.pipeThrough(
        new DecompressionStream("gzip")
      );
      const chunks = [];
      const iter = this.#readableStreamIter(unzippedStream)
      for await (const chunk of iter) {
        chunks.push(chunk);
      }
      return new Blob(chunks);
    } catch (error) {
      // any "decompression error" will result in the empty Blob
      return new Blob([])
    }
  }

  /**
   * Collects all data for a preset to be saved
   * @param {string} bank - Bank identifier. If undefined, uses current bank
   * @param {number} presetSlot - Preset slot number. If undefined, calculated from bank
   * @returns {Array} Array containing all preset data
   */
  #collectPreset (bank=undefined, presetSlot=undefined) {
    if (bank&&presetSlot===undefined) {
      presetSlot = this.presetSlotByBank(bank)
    } else if (presetSlot===undefined) {
      presetSlot = this.presetSlotByBank()    
    }
     
    this.#checkPatternAndInstSTEP()
    let instSettingsClone = stringify(this.instSettings, {
      detectUtcTimestamps: false, fullPrecisionFloats: true
    })
    instSettingsClone = parse(instSettingsClone)
    let playbackQueueClone = stringify(this.#playbackQueue)
    playbackQueueClone = parse(playbackQueueClone)

    let savedPreset = [
      Array.from(this.#collectPatternsForPreset), // 0
      playbackQueueClone, // 1
      instSettingsClone, // 2

      // TABLE Display parameters 3
      [
        this.#playbackQueue.length, 
        this.#playbackQueue[      
          this.#playbackQueue.length-1][3]+1,
        this.#patternNumber
      ],

      this.#muteBits, // 4
      this.#soloBits, // 5

      this.#CYCLE, // 6
      this.#quantize, // 7
      this.PRESETS[presetSlot][
        this.PRESETS[presetSlot].length - 1
      ].slice(), // preset's name
    ]
    // this.Log("\ncollectPreset(): savedPreset", savedPreset, "\n")
    return savedPreset
  }

  
  /** 
   * Stores the currently captured preset data and its slot number
   * [0] - Preset slot number as string
   * [1] - Array containing preset data
   * Currently used for operations.
   * @private
   */
  #currentPresetCaptured = ['', []]

  /** Bank identifier to be copied from */
  #bankToBeCopyFrom = ""
  
  /**
   * Bank storage structure
   * [0] - array storing all 16 presets in the bank
   * [1] - name of the bank
   */
  #bank = [ new Array(16), "" ]
  
  /**
   * Stores banks' names. Slots [2..=7] are user banks, their names can be changed.
   */
  banks = ["FB 1", "FB 2", "UB 1", "UB 2", "UB 3", "UB 4", "UB 5", "UB 6"]
  
  /**
   * Collects all presets for a bank to be saved
   * Does not produce a full bank clone, used only with SAVE for exporting as a file
   * @param {string} bankId - Bank identifier
   * @returns {Promise<Array>} Promise resolving to the bank data structure
   */
  async #collectBank(bankId) {
    const bankId_ = bankId
    return new Promise(async (resolve) => {
      let start_preset = this.presetSlotByBank(bankId_, 0)
      // this.Log("start_preset:", start_preset)
      for (let preset = start_preset; preset < start_preset + 16; preset++) {
        const obj = this.PRESETS[preset]
        this.#bank[0][preset - start_preset] = obj
      }
      // this.Log("bankId:", bankId_)
      // this.Log("bank:Len:name", this.#bank.length, this.#get_currentBank_fileExtention(bankId_))
      this.#bank[1] = this.#get_currentBank_fileExtention(bankId_).slice(0, -10)
      resolve(this.#bank)
    })  
  }

  /**
   * Buffer for undo operations on presets
   * [0] - preset slot
   * [1] - preset buffer
   */
  #undoPresetBuffer = [undefined, undefined]

  /**
   * Buffer for undo operations on banks
   * [0] - preset slot
   * [1] - bank buffer array
   */
  #undoBankBuffer = [undefined, []]

  /**
   * Checks if the current bank is a factory bank
   * @returns {boolean} True if current bank is a factory bank
   */
  isCurrentBankFactory = () => {
    return this.currentBank.slice(0, 1) === 'F'
  }

  /**
   * Checks if a factory preset is currently being played
   * @returns {boolean} True if a factory preset is being played
   */
  isFactoryPlayed = () => {
    if (this.#selectedBank) {
      return this.#selectedBank[0] === 'F'
    }
    return this.oldBank[0] === 'F'
  }

  /** Flag indicating if an alert is currently displayed */
  isOngoingAlert = false
  
  /** Flag indicating if recall operation was intentionally triggered */
  isRecallIntentional = false

  /**
   * Displays an error alert for data format issues
   * @param {string} dataName - Type of data with format error (e.g., "BANK", "PRESET")
   * @param {string} infoField - Additional information to display
   */
  dataFormatErr (dataName, infoField) {
    // this.Log("dataFormatErr:", dataName, infoField)
    let alert_message = 
      `OK @UNSUPPORTED ${dataName} FORMAT. `
    let info = infoField?` STAYING WITH ${infoField}`:""
    this.Alert([
      alert_message+info,
      (OK) =>{ this.Alert() }, 
      false
    ])
    return
  }
  
  /**
   * Manages edit commands (SAVE, RECALL, LOAD, COPY, INS/UNDO, DEL)
   * @param {string} command_name - The edit command to execute
   * @param {*} payload - Optional data for the command
   * @param {boolean} altKey - Whether Alt key is pressed
   * @param {string} filename_on_load - Filename when loading data
   * @param {number} storedLocation - Optional preset location
   * @returns {Promise<void>}
   */
  async consumeEditKey (
    command_name, payload=undefined, altKey=false, filename_on_load="",
    storedLocation=undefined
  ) {
    // Handle operations based on current mode (bank table, queue table, or track write)
    if (this.isQueueTable && !this.TRACK_WRITE) {
      return this.#handleQueueTableOperations(command_name);
    }
    
    // Handle common operations for all modes
    switch (command_name) {
      case 'SAVE':
        return await this.#handleSaveOperation();
      
      case 'RECALL':
        return await this.#handleRecallOperation(payload);
      
      case 'LOAD':
        return await this.#handleLoadOperation(payload, filename_on_load, storedLocation);
    }
    
    // Handle track write mode operations
    if (this.TRACK_WRITE) {
      switch (command_name) {
        case 'COPY':
          return this.#handleCopyOperation();
        
        case 'INS/UNDO':
          if (this.isBankTable && altKey || this.isBankTable && this.#altKey) {
            return this.#handleUndoOperation();
          }
          return this.#handleInsertOperation();
          
        case 'DEL':
          this.#deletePattern();
          // Update LAST STEP key if queue is down to 1 item
          if (this.getPlaybackQueueLength() === 1) {
            this.StateSetters['LAST STEP-reload'](state => !state);
          }
          break;
      }
    }
  }

  /**
   * Handles queue table specific operations
   * @param {string} command_name - The command to execute
   * @private
   */
  #handleQueueTableOperations(command_name) {
    this.#switchEditKeysLights(command_name);
    
    switch (command_name) {
      case 'COPY':
        this.#COPY_TO = true;
        this.#copyPatterns();
        break;
      case 'INS/UNDO':
        this.#pastePatterns();
        break;
      case 'DEL':
        this.#deletePatterns();
        // Update LAST STEP key if queue is down to 1 item
        if (this.getPlaybackQueueLength() === 1) {
          this.StateSetters['LAST STEP-reload'](state => !state);
        }
        break;
    }
  }

  /**
   * Handles the SAVE operation
   * @private
   */
  async #handleSaveOperation() {
    if (this.#selectedBank) {
      // Save current preset to the selected bank
      await this.consumePreset(this.currentPreset, this.presetSlotByBank(this.#selectedBank), true);
      // Collect all bank data
      const bank_obj = await this.#collectBank(this.#selectedBank);
      // Convert to blob for file saving
      const blob = await this.#zipObjectToBlob(bank_obj);
      // Save file with appropriate extension
      await this.#saveFile(blob, this.#get_currentBank_fileExtention(this.#selectedBank));
      return;
    }

    // SAVE preset
    const preset_obj = this.#collectPreset(this.oldBank);
    const blob = await this.#zipObjectToBlob(preset_obj);
    await this.#saveFile(blob, this.#get_currentPreset_fileExtention(preset_obj[8]));
  }

  /**
   * Handles the RECALL operation
   * @param {*} payload - The preset location to recall
   * @private
   */
  async #handleRecallOperation(payload) {
    if (!this.isRecallIntentional) {
      // Calculate the preset location to recall
      const location = this.presetSlotByBank(
        this.currentBank !== this.oldBank ? this.oldBank : this.currentBank
      );
      // Get name of bank or preset to display in confirmation
      const name = this.#selectedBank ?
        this.getUserBankName(this.#selectedBank) :
        this.PRESETS[location][8];

      // Show confirmation dialog
      this.Alert([
        `RECALL @RECALL | ${name} | ?`,
        async (RECALL) => {
          this.isRecallIntentional = true;
          await this.consumeEditKey('RECALL', location);
          this.Alert();
        }, 
        (CANCEL) => { this.Alert(); }
      ]);
      return;
    }
    
    if (this.isRecallIntentional) {
      // Reset scale settings
      this.#resetBaseScaleOthers(true);
      const location = payload;

      if (this.#selectedBank) {
        this.#recallBank(location);
      } else {
        this.#recallPreset(location);
      }

      // Reset last active state
      this.setLastActive('', true);

      // Clear local storage
      localStorage.clear();
      this.isRecallIntentional = false;
    }
  }

  /**
   * Recalls a bank from storage
   * @param {*} location - The preset location
   * @private
   */
  #recallBank(location) {
    // Calculate starting preset slot for the bank
    let start_preset = this.presetSlotByBank(this.#selectedBank, 0);
    // Restore all 16 presets in the bank
    for (let preset = start_preset; preset < start_preset + 16; preset++) {
      if (this.PRESETS_RECALL[preset]) {
        this.PRESETS[preset] = this.PRESETS_RECALL[preset].slice(); // may cause bugs!
      } else {
        this.PRESETS[preset] = this.#generateEmptyPreset();
      }
    }
    // Trigger UI update for bank table
    this.StateSetters['BankTABLEreload'](state => !state);

    // If selected bank is the current bank, update memory with current preset
    if (this.#selectedBank === this.oldBank) {
      this.#setMemory(this.PRESETS[location], this.PRESETS[location][8] === "init");
    }
  }

  /**
   * Recalls a preset from storage
   * @param {*} location - The preset location
   * @private
   */
  #recallPreset(location) {
    if (this.PRESETS_RECALL[location]) {
      // Restore preset name
      this.PRESETS[location][8] = this.PRESETS_RECALL[location][8];
      // Load preset into memory
      this.#setMemory(this.PRESETS_RECALL[location]);
    } else {
      // Load empty preset if no recall data exists
      this.#setMemory(this.#generateEmptyPreset(), true);
    }
    // Trigger UI update for current preset
    this.StateSetters[this.currentPreset+'r'](state => state + 1);
  }

  /**
   * Handles the LOAD operation
   * @param {*} payload - The data to load
   * @param {string} filename_on_load - The filename being loaded
   * @param {*} storedLocation - The storage location
   * @private
   */
  async #handleLoadOperation(payload, filename_on_load, storedLocation) {
    if (!payload) return;

    if (this.#selectedBank) {
      await this.#loadBank(payload, filename_on_load, storedLocation);
    } else {
      await this.#loadPreset(payload, filename_on_load, storedLocation);
    }

    // Clear file input element
    const fileInput = document.getElementById('loadedFile');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  /**
   * Loads a bank from external data
   * @param {*} payload - The bank data
   * @param {string} filename_on_load - The filename
   * @param {*} storedLocation - The storage location
   * @private
   */
  async #loadBank(payload, filename_on_load, storedLocation) {
    // Unzip the bank data
    const unzipped = await this.#unzipObject(payload);
    const blob_to_text = await unzipped.text();
    
    let data;
    try {
      // Parse the bank data
      data = parse(blob_to_text);
      if (!data) {
        this.dataFormatErr("BANK", this.getUserBankName(this.#selectedBank));
        return;
      }
    } catch (_) {
      // Handle parsing errors
      this.dataFormatErr("BANK", this.getUserBankName(this.#selectedBank));
      return;
    }

    const bank_name = data[1];
    const bank = data[0];

    // Validate bank data format (shallow check)
    if (data.length !== 2 || bank.length !== 16 || bank[0].length !== 9 || typeof bank_name !== "string") {
      this.dataFormatErr("BANK", this.getUserBankName(this.#selectedBank));
      return;
    }
    
    // Update bank name if filename differs from bank name
    if (bank_name !== filename_on_load.slice(0, -10)) { 
      this.banks[Number(this.#selectedBank.slice(3)) + 2] = filename_on_load.slice(0, -10);
    }
    
    // Load bank data into PRESETS array
    const start_preset = this.presetSlotByBank(this.#selectedBank, 0);
    for (let preset = start_preset; preset < start_preset + 16; preset++) {
      this.PRESETS[preset] = bank[preset-start_preset].slice();
      this.PRESETS_RECALL[preset] = bank[preset-start_preset].slice();
    }
    
    // Update bank table UI
    this.StateSetters['BankTABLEreload'](state => !state);

    // If selected bank is current bank, update working memory
    if (this.#selectedBank === this.oldBank && !storedLocation) {
      this.#setMemory(bank[this.currentPreset.slice(3)], false);
    }
  }

  /**
   * Loads a preset from external data
   * @param {*} payload - The preset data
   * @param {string} filename_on_load - The filename
   * @param {*} storedLocation - The storage location
   * @private
   */
  async #loadPreset(payload, filename_on_load, storedLocation) {
    const unzipped = filename_on_load ? await this.#unzipObject(payload) : payload;
    const blob_to_text = await unzipped.text();
    
    // Determine preset location
    const location = storedLocation || this.presetSlotByBank(
      this.currentBank !== this.oldBank ? this.oldBank : this.currentBank
    );
    
    let data;
    try {
      // Parse preset data
      data = parse(blob_to_text);
      if (!data) {
        this.dataFormatErr("PRESET", this.PRESETS[location][8]);
        return;
      }
    } catch (_) {
      // Handle parsing errors
      this.dataFormatErr("PRESET", this.PRESETS[location][8]);
      return;
    }

    // Validate preset format (shallow check)
    if (!(data.length <= 9 && 
          data[0] && data[1] && data[2] && 
          data[3].length === 3 &&
          Number.isInteger(data[4]) && 
          Number.isInteger(data[5]) &&
          (typeof data[6] === 'boolean') && 
          (typeof data[7] === 'boolean'))) {
      this.dataFormatErr("PRESET", this.PRESETS[location][8]);
      return;
    }

    // Use filename as preset name if available
    if (filename_on_load) {
      data[8] = filename_on_load.slice(0, -12);
    }
    
    // Update preset in PRESETS table and working memory
    this.PRESETS[location] = data.slice();
    this.StateSetters['BankTABLEreload'](state => !state);
    this.#setMemory(data, false);

    // Store for recall functionality
    this.PRESETS_RECALL[location] = data.slice();
  }

  /**
   * Resets the main display messages to their default values
   * 
   * This method restores the tempo display to show the current tempo value
   * and resets the LED control variable display to show the current global mode.
   * Used primarily after exiting special modes like COPY where custom messages
   * are displayed.
   */
  resetMAIN_KEYS_MESSAGE() {
    this.setTempo(this.instSettings['tempo_wheel'][0])
    this.setLCV(this.TRACK_WRITE ? 'SHIFT' : this.#GLCV)
  }

  /**
   * Handles the COPY operation
   * @private
   */
  #handleCopyOperation() {
    // If COPY is already active, deactivate it
    if (this.#COPY_TO) {
      this.#switchEditKeysLights('COPY', true);
      this.#COPY_TO = false;
      this.resetMAIN_KEYS_MESSAGE()
      this.#clearCOPY_TO_BUFFER(true, true)

      // Clear selected bank for copy operation
      this.#bankToBeCopyFrom = "";
      return;
    }

    this.#COPY_TO = true;
    this.#switchEditKeysLights('COPY');

    // on the MEAS
    if (!this.isBankTable) {
      const measure = this.SELECTOR_CODE[3]+1
      // Copy instrument or pattern based on current mode
      if (this.GLOBAL_LED_CONTROL_VARIABLE() === 'INST SELECT') {
        this.#copyInstrument(this.SELECTOR_CODE, this.#COPY_BUFFER);
        this.setTempo('M'+measure)
        this.setLCV(`INSERT ${this.SELECTED_INST} TO`)
      } else {
        this.#copyPattern(this.SELECTOR_CODE, this.#COPY_BUFFER);
        this.setTempo('M'+measure)
        this.setLCV(`INSERT MEAS ${measure} TO`)
      }
    } // on the BANK
      else if (this.isBankTable && this.#selectedBank) {
      
      // If the user has changed the preset and immediately copied the bank,
      // the preset is not committed from the operative memory(#memory) to the persistent memory(PRESETS[]),
      // so we need to capture the preset from the operative memory and store it in the undo buffer,
      // so we can restore it after the bank is copied.
      // Potential bug: #undoPresetBuffer is used for undo operations so there might be a conflict. Use #currentPresetCaptured instead. See #insertBank().

      this.#undoPresetBuffer = [this.currentPreset.slice(3), this.#collectPreset(this.oldBank), ]
      
      // Store selected bank for bank copy operation
      this.#bankToBeCopyFrom = this.#selectedBank
      let bankToBeCopyFromName = this.getUserBankName(this.#bankToBeCopyFrom)

      this.setTempo(bankToBeCopyFromName.slice(0, 3))
      switch (this.#GLCV) {
        case 'LAST STEP':
        case 'SHUFF /FLAM':
        case 'TOTAL ACCENT':
        case 'INST SELECT':
          break
        default: 
          this.setLCV('DISABLED TILL INSERT')
      }

    } // on the PRESET
      else if (this.isBankTable) {
      const presetName = this.getCurrentPresetName().slice(0, 9)

      this.setTempo(presetName.slice(0, 3))
      this.setLCV(`INSERT ${presetName.slice(0, 5).toUpperCase()} TO ?`)
      // Store selected preset for preset copy operation
      this.#COPY_BUFFER_PRESET = this.#collectPreset(this.oldBank);
    }
  }

  /**
   * Handles the UNDO operation
   * @private
   */
  #handleUndoOperation() {
    if (this.#undoBankBuffer[0] !== undefined) {
      return this.#undoBank();
    }
    
    if (this.#undoPresetBuffer[0] !== undefined) {
      return this.#undoPreset();
    }
  }

  /**
   * Undoes a bank operation
   * @private
   */
  #undoBank() {
    let to_start_preset = this.#undoBankBuffer[0];
    let count = 0;
    // Restore all presets from undo buffer
    while (count < 16) {
      this.PRESETS[to_start_preset] = this.#undoBankBuffer[1][count].slice();
      to_start_preset++;
      count++;
    }

    // If current bank is affected, update working memory
    if (this.currentBank === this.oldBank) {
      this.#setMemory(this.#undoBankBuffer[1][count - 16 + Number(this.currentPreset.slice(3))]);
    }

    // Clear undo buffer and update UI
    this.#undoBankBuffer[0] = undefined;
    this.StateSetters['BankTABLEreload'](state => !state);
    this.#switchEditKeysLights('INS/UNDO', true);
  }

  /**
   * Undoes a preset operation
   * @private
   */
  #undoPreset() {
    // Restore preset from undo buffer
    this.PRESETS[this.#undoPresetBuffer[0]] = this.#undoPresetBuffer[1];

    // Update UI
    this.StateSetters['BankTABLEreload'](state => !state);

    // Update working memory if current preset was restored
    if (this.#undoPresetBuffer[0] === this.presetSlotByBank()) {
      this.#setMemory(this.#undoPresetBuffer[1], false);
    }

    // Clear undo buffer and update UI
    this.#undoPresetBuffer[0] = undefined;
    this.#switchEditKeysLights('INS/UNDO', true);
  }

  /**
   * Handles the INSERT operation
   * @private
   */
  #handleInsertOperation() {
    if (!this.#COPY_TO) { return }
    
    // this.setLCV(this.#GLCV)
    // INSERT bank operation
    if (this.isBankTable && this.#selectedBank && this.#bankToBeCopyFrom) {
      if (this.#selectedBank === this.#bankToBeCopyFrom) return;
      
      this.#insertBank();
      this.#clearCOPY_TO_BUFFER(true, true)
      return;
    }
    
    // INSERT preset operation
    if (this.isBankTable && this.#COPY_TO && this.#toBeSavedOldPreset) {
      if (this.#COPY_TO_BUFFER.size>0) {
        this.#insertPresets();
        this.#clearCOPY_TO_BUFFER(true, true)
      } else {
        this.#insertPreset();
        this.#clearCOPY_TO_BUFFER(true, true)
      }
      return;
    }
    
    // Pattern procedures (when not in bank table)
    if (this.#COPY_TO && !this.isBankTable) {
      this.#insertPatterns();
      this.#clearCOPY_TO_BUFFER(true, true)
    }
  }

  /**
   * Inserts (copies) one bank to another
   * @private
   */
  #insertBank() {
    // Calculate preset indices
    let to_start_preset = this.presetSlotByBank(this.#selectedBank, 0);
    let from_start_preset = this.presetSlotByBank(this.#bankToBeCopyFrom, 0);

    // See #handleCopyOperation - on the BANK
    const currentPresetCapturedSlotToCommit = this.presetSlotByBank(this.oldBank, this.#undoPresetBuffer[0])
    this.PRESETS[Number(currentPresetCapturedSlotToCommit)] = this.#undoPresetBuffer[1]
    // ------------------------------------------------------------
    
    let count = 0;
    while (count < 16) {
      // Store current presets for undo
      this.#undoBankBuffer[1][count] = this.PRESETS[to_start_preset].slice();
      // Copy presets from source to destination
      this.PRESETS[to_start_preset] = this.PRESETS[from_start_preset].slice();

      to_start_preset++;
      from_start_preset++;
      count++;
    }
    // Store starting preset index for undo
    this.#undoBankBuffer[0] = to_start_preset - 16;
    
    // Update working memory if needed
    if (this.#selectedBank === this.oldBank) {
      this.#setMemory(this.PRESETS[to_start_preset - 16 + Number(this.currentPreset.slice(3))]);
    }

    // Update UI state
    this.#switchEditKeysLights('COPY', true)
    this.#switchEditKeysLights('INS/UNDO')
    this.resetMAIN_KEYS_MESSAGE()

    this.#COPY_TO = false;
    this.#bankToBeCopyFrom = "";

    this.StateSetters['BankTABLEreload'](state => !state);
  }

  /**
   * Inserts multiple presets from the copy buffer into their target locations
   * @private
   */
  #insertPresets() {
    // Deactivate copy mode
    this.#COPY_TO = false;

    // Copy preset data to each target location
    for (const [slotAddress, presetSlot] of this.#COPY_TO_BUFFER.entries()) {
      // Copy preset data to target slot
      this.PRESETS[presetSlot] = this.#COPY_BUFFER_PRESET.slice();
      // Update UI state for the preset slot
      this.StateSetters['PRa'+slotAddress+'r'](state => !state);
    }

    // Clear copy buffers
    this.#COPY_TO_BUFFER.length = 0;
    this.#COPY_BUFFER_PRESET.length = 0;
    this.resetMAIN_KEYS_MESSAGE()
  }

  /**
   * Inserts a preset
   * @private
   */
  #insertPreset() {
    this.#switchEditKeysLights('COPY', true)
    this.#switchEditKeysLights('INS/UNDO') // potential UNDO OPERATION
    this.resetMAIN_KEYS_MESSAGE()
    
    // Store current preset for undo
    const currentPresetSlot = this.presetSlotByBank()

    // no factory preset is overwritten
    if (currentPresetSlot < 15) { return }
    const currentPreset = this.#collectPreset();
    
    this.#undoPresetBuffer = [currentPresetSlot, currentPreset];

    // Deactivate copy mode and update UI
    this.#COPY_TO = false;
    this.StateSetters['BankTABLEreload'](state => !state);
    // Load copied preset into memory
    this.#setMemory(this.#toBeSavedOldPreset, false, false);
  }

  /**
   * Inserts patterns
   * @private
   */
  #insertPatterns() {
    // Deactivate copy mode
    this.#COPY_TO = false;
    this.#switchEditKeysLights('COPY', true);
    this.resetMAIN_KEYS_MESSAGE()
    
    // Skip if buffer is empty
    if (!this.#COPY_TO_BUFFER.size) {
      return;
    }
    
    // Process all patterns in copy buffer
    const patternsToCopyIn = this.#COPY_TO_BUFFER.values();
    let selectorCode = patternsToCopyIn.next();

    // Paste instruments or patterns based on current mode
    if (this.GLOBAL_LED_CONTROL_VARIABLE() === 'INST SELECT') {
      while (selectorCode.value) {
        this.#pasteInstrument(selectorCode.value, this.#COPY_BUFFER);
        selectorCode = patternsToCopyIn.next();
      }
    } else {
      while (selectorCode.value) {
        this.#pastePattern(selectorCode.value, this.#COPY_BUFFER);
        selectorCode = patternsToCopyIn.next();
      }
    }

    // Clear buffer and update visuals
    this.#clearCOPY_TO_BUFFER()

    // Update UI and pattern state
    this.setMksState();
    this.updatePatternAndInstSTEP();
    this.#updateScaleBase(false);
    this.#updateSHUFFLEandFLAM();
    this.#changeGridForNewBASE();
  }

  /** 
   * Status of edit keys (COPY, INS/UNDO, DEL, SAVE, RECALL, LOAD)
   * Default is `0b000000`, all `OFF`
   * @type {number}
   * @private
   */
  #editKeysStatus = 0
  
  /** 
   * CSS classes to disable edit keys 
   * @type {string}
   */
  editKeysDisable = ' pe-none fade-clear '
  
  /**
   * Sets or clears a specific bit in the edit keys status
   * 
   * @param {number} bit - The bit position to modify (1-6)
   * @param {boolean} value - Whether to set (true) or clear (false) the bit
   * @returns {boolean} The value parameter
   * @private
   */
  #setEditKeysStatusBit(bit, value) {
    if (value) {this.#editKeysStatus |= 1 << (bit-1)
    } else { this.#editKeysStatus ^= 1 << (bit-1) }
    return value
  }
  
  /** 
   * Checks if a specific edit key should be enabled
   * Any number except `0(zero)` returned means the edit key must be `ON`
   * 
   * Bit map:
   * `COPY(6), INS/UNDO(5), DEL(4), SAVE(3), RECALL(2), LOAD(1)`
   * 
   * @param {number} bit - The bit position to check (1-6)
   * @returns {number} Non-zero if the key should be enabled
   */
  getEditKeyStatus(bit) {
    return this.#editKeysStatus & 1 << (bit-1)
  }
  
  /**
   * Updates the status of all edit keys based on current application state
   * Considers TRACK_WRITE mode, bank/queue table status, and factory preset status
   */
  setEditKeysStatus() {
    this.#editKeysStatus = !this.TRACK_WRITE?
    (this.isBankTable || !this.isQueueTable)?0b000101:0b111101
    :
    (this.isBankTable || !this.isQueueTable)?0b110111:0b111111

    // extra rule for LOAD
    this.isFactoryPlayed()?
    !this.#setEditKeysStatusBit(1, 0)&&this.isBankTable&&this.getEditKeyStatus(5)&&this.#setEditKeysStatusBit(5, 0)
    :
    this.#setEditKeysStatusBit(1, 1)

    // extra rule for RECAL, works only when BANK is open
    this.isBankTable?
    !this.getEditKeyStatus(2)&&this.#setEditKeysStatusBit(2, 1)
    :
    this.getEditKeyStatus(2)&&this.#setEditKeysStatusBit(2, 0)
    
    // reload EditCommands and others
    this.StateSetters["EC"](state => state + 1)
    this.StateSetters['CLEAR-reload'](state => state + 1)
  }

  /**
   * Currently selected bank in the bank table
   * @type {string}
   * @private
   */
  #selectedBank = ""
  
  /**
   * Current bank identifier
   * @type {string}
   */
  currentBank = 'FBa0'
  
  /**
   * Previous bank identifier
   * @type {string}
   */
  oldBank = this.currentBank
  
  /**
   * Gets the user-friendly name of a bank
   * 
   * @param {string} [bankSlot=this.oldBank] - Bank identifier (e.g., 'FBa0', 'UBa1')
   * @returns {string} User-friendly bank name
   */
  getUserBankName = (bankSlot=this.oldBank) => {
    if (bankSlot[0]==='F') { 
      // this.Log("getUserBankName::factory bank", bankSlot)
      return this.banks[Number(bankSlot.slice(3))] }
    return this.banks[Number(bankSlot.slice(3)) + 2]
  }

  /**
   * Handles bank selection and switching
   * Updates UI elements and edit key status accordingly
   * 
   * @param {string} bankId - Bank identifier to consume
   */
  consumeBank (bankId) {

    this.#selectedBank = undefined
    if (document.getElementById(bankId).classList.contains('glow-cyan')) {
      document.getElementById(bankId).classList.remove('glow-cyan')

      this.setEditKeysStatus()
      return
    }

    if (bankId===this.currentBank) {
      this.#selectedBank&&document.getElementById(this.#selectedBank).classList.remove('glow-cyan')
      this.#selectedBank = bankId

      document.getElementById(bankId).classList.add('glow-cyan')

      // PRESETs related
      if (this.#COPY_TO && this.isBankTable && !this.#bankToBeCopyFrom) {
        if (bankId.slice(0, 2) === 'UB') {
          const bankIdx = Number(bankId.slice(3))

          const presetName = this.#COPY_BUFFER_PRESET.length>0?this.#COPY_BUFFER_PRESET[8].slice(0, 9):this.getCurrentPresetName().slice(0, 9)
          let userBankName = this.getUserBankName(bankId)
          userBankName = userBankName.slice(0, 1)==='F'?'?':userBankName
          this.setTempo(presetName.slice(0, 3))
          this.setLCV(`INSERT ${presetName.slice(0, 5).toUpperCase()} TO ${userBankName.toUpperCase()} ${this.#COPY_TO_BUFFER.size>0?'':'?'}`)

          // remap COPY_TO_BUFFER for a new bank
          if (bankId.slice(0, 2) === 'UB') {
            for (let presetSlot of this.#COPY_TO_BUFFER.keys()) {
              this.#COPY_TO_BUFFER.set(presetSlot, presetSlot+(bankIdx+2)*16)
            }
          }
        }
        // BANKs related
      } else if (this.#COPY_TO && this.isBankTable && this.#bankToBeCopyFrom) {
        let bankToBeCopyFromName = this.getUserBankName(this.#bankToBeCopyFrom)
        // let userBankName = this.getUserBankName(this.#selectedBank)
        // userBankName = userBankName.slice(0, 1)==='F'?'?':userBankName

        this.setTempo(bankToBeCopyFromName.slice(0, 3))
        // this.setLCV(`INSERT ${bankToBeCopyFromName.slice(0, 4)} TO ${userBankName}`)

      }
    }

    if (bankId!==this.oldBank) {
      this.StateSetters[this.currentPreset](false)
      this.StateSetters[this.oldBank+'g'](true)
    } else {
      this.StateSetters[this.currentPreset](true)
      this.StateSetters[this.oldBank+'g'](false)
    }

    this.StateSetters[this.currentBank](false)
    this.StateSetters[bankId](true)
    this.currentBank = bankId

  
    // refresh the preset table
    for (let i=0; i<16; i++) {
      this.StateSetters['PRa'+i+'r'](state => !state)
    }    

    // we allow UNDO operation only if the current bank where the INS operation has happened has not been switched.
    this.#switchEditKeysLights('INS/UNDO', true)
    this.setEditKeysStatus()
    
    this.#undoBankBuffer[0] = undefined
    this.#undoPresetBuffer[0] = undefined

  }

  /**
   * Current preset identifier
   * @type {string}
   */
  currentPreset = 'PRa0'
  
  /** 
   * Every time a preset is consumed this collects its state.
   * Used as a reusable cache-container by `consumeEditKey() ... 'COPY'` 
   * @type {Array}
   * @private
   */
  #toBeSavedOldPreset

  /**
   * Handles preset selection and switching
   * Saves current preset state and loads the new preset
   * 
   * @param {string} presetId - Preset identifier to consume
   * @param {number} presetLocation - Location number in the PRESETS array
   * @param {boolean} [internal=false] - Whether this is an internal operation
   * @returns {Promise<void>}
   */
  async consumePreset (presetId, presetLocation, internal=false) {

    if (presetLocation < 31) {
      this.#COPY_TO = false
      this.#switchEditKeysLights('COPY', true);
      this.setLCV(this.TRACK_WRITE ? 'SHIFT' : this.#GLCV)
    }

    if (!internal) {
      this.#selectedBank = undefined
      if (document.getElementById(this.currentBank).classList.contains('glow-cyan')) {
        document.getElementById(this.currentBank).classList.remove('glow-cyan')
        // this.Log(`SelectedBank with cyan: ${this.#selectedBank}`)
      }
    }

    const oldPreset = this.#collectPreset(this.oldBank)
    // const blob = new Blob([JSON.stringify(oldPreset, null, 0)])
    // const blob_text = await blob.text()
    // this.#toBeSavedOldPreset = JSON.parse(blob_text)
    this.#toBeSavedOldPreset = oldPreset
      
    this.PRESETS[this.presetSlotByBank(this.oldBank)] = this.#toBeSavedOldPreset

    // alternate presets
    this.StateSetters[this.currentPreset](false)
    this.StateSetters[presetId](true)
    this.currentPreset = presetId

    this.oldBank&&this.StateSetters[this.oldBank+'g'](false)
    this.oldBank = this.currentBank
  
    // commit the preset to the working memory
    this.#resetBaseScaleOthers() 
    this.#setMemory(this.PRESETS[presetLocation], false)
    let rawPresetName = this.PRESETS[presetLocation][8].slice()

    // Display the preset's name
    // this.StateSetters['setPresetName'](rawPresetName)
    this.StateSetters['sbPreset'](rawPresetName)
    this.StateSetters['sbBank'](this.getUserBankName())
    this.setEditKeysStatus()
  }

  /**
   * Gets the name of the preset currently being played
   * 
   * @returns {string} The name of the preset in play
   * @private
   */
  #playedPresetName = () => {
    return this.PRESETS[this.presetSlotByBank(
      this.currentBank!==this.oldBank?this.oldBank:this.currentBank
    )][8]
  }
  
  /**
   * Changes the name of a preset or bank
   * 
   * @param {number} slotAddress - Slot address in the PRESETS or banks array
   * @param {string} newPresetOrBankName - New name to set
   * @param {boolean} [isPreset=true] - Whether changing a preset (true) or bank (false) name
   * @param {Function} [updatePresetSlot=()=>{}] - Callback to update UI after name change
   */
  changePresetOrBankName (slotAddress, newPresetOrBankName, isPreset=true, updatePresetSlot=()=>{}) {
    if (isPreset) {
      if (this.currentBank.slice(0, 1) !== 'F') {

        this.PRESETS[slotAddress][this.PRESETS[slotAddress].length-1] = newPresetOrBankName.slice()
        this.StateSetters['sbPreset'](this.#playedPresetName())
        updatePresetSlot(state => state += 1)
      }
      return
    }
    this.currentBank===this.oldBank&&this.StateSetters['sbBank'](newPresetOrBankName.slice())
    this.banks[slotAddress+2] = newPresetOrBankName.slice()
  }

  /**
   * Gets the tempo of the current instrument in raw values
   * Must be multiplied by this.#grid to get the 4/4 or 3/4, etc., metrics
   * 
   * @returns {number} Raw tempo value
   * @private
   */
  #giveTempo = () => {return this.instSettings['tempo_wheel'][0]}
  
  /**
   * Current beat position in the pattern
   * @type {number}
   * @private
   */
  #beatRunnerCounter = 0
  
  /**
   * First beat of the pattern (can be offset)
   * @type {number}
   */
  firstBeat = 0
  
  /**
   * Moves the beat runner forward to the next step
   * Updates UI and handles pattern transitions
   * @private
   */
  #moveBeatRunner () {
    this.firstBeat = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][16]


    this.#moveToNextPattern(this.#beatRunnerCounter)

    // increase the counter
    this.#beatRunnerCounter = (this.#beatRunnerCounter + 1 ) % this.BASE

    // move the runner 
    let beatPlace = this.#beatRunnerCounter
    if (!beatPlace) {
      beatPlace = this.firstBeat 
    }
  
    this.StateSetters['setBeatLightX'](88 + beatPlace * 79)

  }
  
  /**
   * Flag indicating if pattern should play in reverse
   * @type {number}
   */
  invert = 0
  
  /**
   * Moves the beat runner backward to the previous step
   * Used when pattern is in reverse mode
   * @private
   */
  #moveBeatRunnerBackward () {
    this.firstBeat = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][16]


    this.#moveToNextPattern(this.#beatRunnerCounter)

    // increase the counter
    this.#beatRunnerCounter = (this.BASE + this.#beatRunnerCounter - 1 ) % this.BASE

    // move the runner 
    let beatPlace = this.#beatRunnerCounter
    if (!beatPlace) {
      beatPlace = this.firstBeat
    }
  
    this.StateSetters['setBeatLightX'](88 + beatPlace * 79)
    // this.Log(`  beatPlace: ${beatPlace}`)
  }

  /**
   * ID for the beat blinking timeout
   * @type {number}
   * @private
   */
  #beatBlinkingID
  
  /**
   * Function to handle beat light blinking
   * @private
   */
  #blinkingFoo = () => {
    this.StateSetters['setBeatLightBlink'](state=>!state)
    this.#beatBlinkingID = setTimeout(this.#blinkingFoo, 60000.0/this.#giveTempo()/2)
  }
  
  /**
   * Starts the beat light blinking animation
   * Blinks at half the tempo rate (eighth notes)
   */
  startBeatBlinking = () => {
    clearTimeout(this.#beatBlinkingID)

    // we blink at a quarter note, which means we have to 
    // switch out at the rate of an 8th note
    this.#beatBlinkingID = setTimeout(this.#blinkingFoo, 60000.0/this.#giveTempo()/2)
  }
  
  /**
   * Stops the beat light blinking animation
   */
  stopBeatBlinking = () => {
    clearTimeout(this.#beatBlinkingID)
    this.StateSetters['setBeatLightBlink'](true)
  }

  /** 
   * Queue of patterns to play in sequence
   * Each entry is a SELECTOR_CODE array
   * @type {Array<Array>}
   * @private
   */
  #playbackQueue = [this.SELECTOR_CODE]
  
  /**
   * Gets the current length of the playback queue
   * @returns {number} Number of patterns in the queue
   */
  getPlaybackQueueLength = () => {return this.#playbackQueue.length}
  
  /**
   * Gets a specific pattern from the playback queue
   * @param {number} patternAddress - Index in the queue
   * @returns {Array} SELECTOR_CODE for the requested pattern
   */
  getPlaybackQueuePattern = (patternAddress) => {
    return this.#playbackQueue[patternAddress]
  }

  /**
   * Audio context for sound playback
   * @type {AudioContext}
   * @private
   */
  #audioCtx = new AudioContext()

  /**
   * Current note being played
   * @type {*}
   */
  currentNote
  
  /**
   * Time to schedule the next note
   * @type {number}
   */
  nextNoteTime = this.#audioCtx.currentTime
  
  /**
   * Time for flam notes
   * @type {number}
   */
  flammedTime = 0
  
  /**
   * ID for the scheduler timer
   * @type {number}
   */
  timerID
  
  /**
   * Number of steps in the pattern (default 16)
   * @type {number}
   */
  BASE = 16
  
  /**
   * Grid division for timing calculations
   * @type {number}
   * @private
   */
  #grid = 4
  
  /** 
   * SELECTOR_CODE of the currently played pattern
   * @type {Array}
   * @private
   */
  #patternLocation = this.#playbackQueue[0]
  
  /**
   * Sets the current pattern location
   * @param {Array} newPatternLocation - New SELECTOR_CODE to use
   */
  setPatternLocation = (newPatternLocation) => {
    this.#patternLocation = newPatternLocation
  }
  
  /** 
   * Index of the currently played pattern within the playback queue
   * @type {number}
   * @private
   */
  #patternNumber = 0
  
  /**
   * Sets the current pattern number in the queue
   * @param {number} newPatternNumber - New index to use
   */
  setPatternNumber = (newPatternNumber) => {
    this.#patternNumber = newPatternNumber
  }

  /**
   * Table of sound generation functions for each instrument
   * @type {Array<Function>}
   * @private
   */
  #soundTABLE = []
  
  /**
   * Creates the sound table with functions for each instrument
   * Maps instrument indices to their sound generation functions
   * @private
   */
  #createSoundTable = () => {
    this.#soundTABLE[this.#I.BD] = (time, a, ta) => this.#playBD(time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.SD] = (time, a, ta) => this.#playSD(time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.LT] = (time, a, ta) => 
      this.#playTom('L', time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.MT] = (time, a, ta) => 
      this.#playTom('M', time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.HT] = (time, a, ta) => 
      this.#playTom('H', time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.RS] = (time, a, ta) => this.#playRim(time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.HC] = (time, a, ta) => this.#playHClap(time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.HHC] = (time, a, ta, audioBuffer, elementId) => 
      this.#playHats(time, a, ta, audioBuffer, elementId, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.HHO] = (time, a, ta, audioBuffer, elementId) => 
      this.#playHats(time, a, ta, audioBuffer, elementId, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.RD] = (time, a, ta) => this.#playRide(time, a, ta, this.#audioCtx, this.#merger)
    this.#soundTABLE[this.#I.CR] = (time, a, ta) => this.#playCrash(time, a, ta, this.#audioCtx, this.#merger) 
  }

  /**
   * Frequency for the metronome click sound
   * @type {number}
   * @private
   */
  #pulseHz = 880*3
  
  /**
   * Duration of the metronome click sound
   * @type {number}
   * @private
   */
  #pulseTime = 1/44
  
  /**
   * Plays a metronome click sound at the specified time
   * 
   * @param {number} time - Time to schedule the click sound
   * @private
   */
  #playClick(time) {
    const osc = new OscillatorNode(this.#audioCtx, {
      type: 'square', frequency: this.#pulseHz
    })

    // envelope
    const gain = new GainNode(this.#audioCtx)
    gain.gain.cancelScheduledValues(time)

    // ADSR attack 
    gain.gain.setValueAtTime(this.#master_gain*0.1, time)

    osc.connect(gain).connect(this.#audioCtx.destination);
    osc.start(time);
    osc.stop(time + this.#pulseTime);
  }

  /**
   * Plays a crash cymbal sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playCrash(time, accent, total_accent, audioCtx, merger) {
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    let soundBuffer = this.#SoundData['CSHD0']

    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: soundBuffer,
      playbackRate: 1,
    })

    soundSource.detune.value = this.instSettings['CRtun'][0]*12

    // level knob
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['CRlev'][0]/100 * this.#master_gain

    soundSource.connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
    // return soundSource;
  }

  /**
   * Plays a ride cymbal sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playRide(time, accent, total_accent, audioCtx, merger) {
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    let soundBuffer = this.#SoundData['RIDED0']

    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: soundBuffer,
      playbackRate: 1,
    })

    soundSource.detune.value = this.instSettings['RDtun'][0]*12.5

    // level knob
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['RDlev'][0]/100 * this.#master_gain

    soundSource.connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
    // return soundSource;
  }

  /**
   * Gets the appropriate hi-hat sound based on decay setting
   * 
   * @param {string} name_ - Hi-hat type ('C' for closed, 'O' for open)
   * @returns {Array} Array containing [AudioBuffer, name_]
   * @private
   */
  #getHatSound(name_) {
    let hatDecay = name_+'Hdec'
    let returnString = 'HH'+name_
    if (this.instSettings[hatDecay][0] === 0) {
      returnString += 'D0'
    } else if (this.instSettings[hatDecay][0] <= 20) {
      returnString += 'D2'
    } else if (this.instSettings[hatDecay][0] <= 40) {
      returnString += 'D4'
    } else if (this.instSettings[hatDecay][0] <= 60) {
      returnString += 'D6'
    } else if (this.instSettings[hatDecay][0] <= 80) {
      returnString += 'D8'
    } else {
      returnString += 'DA'
    }

    /**
     * This function also returns a name_ parameter defining 
     * which hat exactly we are currently playing, closed or open.
     */
    return [this.#SoundData[returnString], name_]
  }

  /**
   * Plays a hi-hat sound (closed or open)
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {Array} [audioBuffer=undefined] - Optional pre-selected audio buffer
   * @param {number} [elementId=undefined] - Element ID to determine hat type
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playHats(time, accent, total_accent, audioBuffer=undefined, elementId=undefined, audioCtx, merger) {
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    if (!audioBuffer) {
      let audioBuffer_

      switch (elementId) {
        case 12: audioBuffer_ = this.#getHatSound('C'); break
        case 13: audioBuffer_ = this.#getHatSound('O'); break
      }
    
      audioBuffer = audioBuffer_
    }

    let decayTime = this.instSettings[audioBuffer[1]+'Hdec'][0]/100

    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: audioBuffer[0],
      playbackRate: 1,
    })

    // envelope
    const Env = new GainNode(audioCtx)
    Env.gain.cancelScheduledValues(time)
    Env.gain.setValueAtTime(1, time + 0.2125) // sustain
    Env.gain.exponentialRampToValueAtTime(0.1, time + 0.2125 + decayTime)

    // level knob
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['HHlev'][0]/100 * this.#master_gain

    soundSource.connect(Env).connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
    // return soundSource;
  }

  /**
   * Plays a hand clap sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playHClap(time, accent, total_accent, audioCtx, merger) {
    let audioBuffer = accent===1?this.#SoundData['HANDCLP1']:this.#SoundData['HANDCLP2']

    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: audioBuffer,
      playbackRate: 1,
    })

    // level knob
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['HClev'][0]/100 * this.#master_gain

    soundSource.connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
    // return soundSource;
  }

  /**
   * Plays a rim shot sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playRim(time, accent, total_accent, audioCtx, merger) {
    let audioBuffer = accent===1?this.#SoundData['RIM63']:this.#SoundData['RIM127']
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: audioBuffer,
      playbackRate: 1,
    })

    // level knob
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['RSlev'][0]/100 * this.#master_gain

    soundSource.connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
    // return soundSource;

  }

  /**
   * Plays a tom drum sound
   * 
   * @param {string} name_ - Tom name identifier (LT, MT, HT)
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playTom(name_, time, accent, total_accent, audioCtx, merger) {
    // Normalize accent values
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    // Get decay time from instrument settings
    let decayTime = this.instSettings[name_+'Tdec'][0]/100

    /**
     * Calculate tuning value based on instrument settings
     * @returns {number} Detune value in cents
     */
    let tune = () => {
      if (this.instSettings[name_+'Ttun'][0] === 0 ||
        this.instSettings[name_+'Ttun'][0] === 100
      ) { 
        return 0 
      } else if (this.instSettings[name_+'Ttun'][0] <= 30) {
        return -300 + this.instSettings[name_+'Ttun'][0]*10
      } else if (this.instSettings[name_+'Ttun'][0] <= 70) {
        return -700 + this.instSettings[name_+'Ttun'][0]*10
      } else if (this.instSettings[name_+'Ttun'][0] <= 99) {
        return -990 + this.instSettings[name_+'Ttun'][0]*10
      } else return 0
    }

    // Create sound source
    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: this.#getTomSound(name_),
      playbackRate: 1,
    });

    // Create and configure envelope
    const Env = new GainNode(audioCtx)
    Env.gain.cancelScheduledValues(time)
    Env.gain.setValueAtTime(1, time + 0.3) // sustain
    Env.gain.exponentialRampToValueAtTime(0.1, time + 0.3 + decayTime + 0.5)

    // Apply tuning
    soundSource.detune.value = tune()
    
    // Configure output level
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings[name_+'Tlev'][0]/100 * this.#master_gain

    // Connect audio nodes
    soundSource.connect(Env).connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
  }

  /**
   * Selects the appropriate tom sound sample based on instrument settings
   * 
   * @param {string} name_ - Tom name identifier (LT, MT, HT)
   * @returns {AudioBuffer} The selected tom sound buffer
   * @private
   */
  #getTomSound(name_) {
    let returnString = name_

    // Add tuning identifier to sample name
    if (this.instSettings[name_+'Ttun'][0] <= 0) {
      returnString += 'T0'
    } else if (this.instSettings[name_+'Ttun'][0] <= 30) {
      returnString += 'T3'
    } else if (this.instSettings[name_+'Ttun'][0] <= 70) {
      returnString += 'T7'
    } else {
      returnString += 'TA'
    }

    // Add decay identifier to sample name
    if (this.instSettings[name_+'Tdec'][0] <= 0) {
      returnString += 'D0'
    } else if (this.instSettings[name_+'Tdec'][0] <= 30) {
      returnString += 'D3'
    } else if (this.instSettings[name_+'Tdec'][0] <= 70) {
      returnString += 'D7'
    } else {
      returnString += 'DA'
    }

    return this.#SoundData[returnString]
  }

  /**
   * Plays a snare drum sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playSD(time, accent, total_accent, audioCtx, merger) {
    // Normalize accent values
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    /**
     * Calculate tuning value based on instrument settings
     * @returns {number} Playback rate multiplier
     */
    let tune = () => {
      if (this.instSettings['SDtun'][0] === 0 ||
        this.instSettings['SDtun'][0] === 31 ||
        this.instSettings['SDtun'][0] === 71 || 
        this.instSettings['SDtun'][0] === 100
      ) { 
        return 1  
      } else if (this.instSettings['SDtun'][0] <= 30) {
        return 1 + (this.instSettings['SDtun'][0]/100) * 1.1
      } else if (this.instSettings['SDtun'][0] <= 70) {
        return 1 + (this.instSettings['SDtun'][0]/100) * 0.15
      } else {
        return 1 + this.instSettings['SDtun'][0]/100 * 0.008
      }
    }

    // Create sound source
    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: this.#getSDSound(),
      playbackRate: tune(),
    });

    // Create and configure envelope
    const Env = new GainNode(audioCtx)
    Env.gain.cancelScheduledValues(time)

    // ADSR attack 
    Env.gain.setValueAtTime(1, time+Math.random()*10)

    // Create high shelf filter for snappy control
    let HSF = new BiquadFilterNode(audioCtx)
    HSF.type = 'highshelf'
    HSF.Q.value = 0.0100

    // Get snare parameters
    let snappy = this.instSettings['SDsna'][0]
    let sd_tone = this.instSettings['SDton'][0]
    let offset = 0.0
    let offset2 = 0.0

    // Calculate offsets based on snappy and tone settings
    if (snappy <= 30) { 
      offset = 0.7*2 
    } else if (snappy <= 70) {
      offset = 0.3*2
    }

    if (sd_tone === 0.0) { 
      offset2 = 0.2
    } else  {
      offset2 = 0.0
    }

    // Configure high shelf filter
    HSF.gain.value = Math.log2(Math.tanh(snappy/100 + offset)+0.01)*20
    HSF.frequency.value = Math.tanh(snappy/100)*25000 + 500

    // Configure output level
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent ) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['SDlev'][0]/100 * this.#master_gain

    // Connect audio nodes
    soundSource.connect(Env).connect(HSF).connect(Level)
    .connect(merger, 0, 0)
    this.#cummulativeGain += Level.gain.value
    soundSource.start(time, 0, sd_tone/50 + offset2);
  }

  /**
   * Selects the appropriate snare drum sound sample based on instrument settings
   * 
   * @returns {AudioBuffer} The selected snare drum sound buffer
   * @private
   */
  #getSDSound() {
    let returnString = 'S'

    // Add tuning identifier to sample name
    if (this.instSettings['SDtun'][0] <= 0) {
      returnString += 'T0'
    } else if (this.instSettings['SDtun'][0] <= 30) {
      returnString += 'T3'
    } else if (this.instSettings['SDtun'][0] <= 70) {
      returnString += 'T7'
    } else {
      returnString += 'TA'
    }

    // Add tone identifier to sample name
    if (this.instSettings['SDton'][0] === 0) {
      returnString += 'T0'
    } else if (this.instSettings['SDton'][0] <= 30) {
      returnString += 'T3'
    } else if (this.instSettings['SDton'][0] <= 70) {
      returnString += 'T7'
    } else {
      returnString += 'TA'
    }

    // Add snappy identifier to sample name
    if (this.instSettings['SDsna'][0] === 0 && 
      this.instSettings['SDton'][0] === 0) {
      returnString += 'S0'
    } else if (this.instSettings['SDsna'][0] <= 30) {
      returnString += 'S3'
    } else if (this.instSettings['SDsna'][0] <= 70) {
      returnString += 'S7'
    } else {
      returnString += 'SA'
    }
    return this.#SoundData[returnString]
  }

  /**
   * Plays a bass drum sound
   * 
   * @param {number} time - Time to schedule the sound
   * @param {number} accent - Accent level (0-2)
   * @param {number} total_accent - Total accent value from pattern
   * @param {AudioContext} audioCtx - Audio context
   * @param {ChannelMergerNode} merger - Channel merger for output
   * @private
   */
  #playBD(time, accent, total_accent, audioCtx, merger) {
    // Normalize accent values
    if (accent===1) {
      accent = 0.6
    } else if (accent===2) accent = 0.8

    // Get bass drum parameters
    let attackTime = (this.instSettings['BDatt'][0]/1000 + Math.random()/4000)/10
    let decayTime = (this.instSettings['BDdec'][0]/133 + 0.250) * 0.25
    let tune = this.instSettings['BDtun'][0]/2000 + 1

    // Create sound source
    const soundSource = new AudioBufferSourceNode(audioCtx, {
      buffer: this.#getBDSound(),
      playbackRate: tune,
    });

    // Create and configure envelope
    const Env = new GainNode(audioCtx)
    Env.gain.cancelScheduledValues(time)

    // ADSR attack
    Env.gain.setValueAtTime(0, time)
    Env.gain.linearRampToValueAtTime(1, time + attackTime)

    // Sustain and decay
    let sustainTime = 0.04
    Env.gain.setValueAtTime(1, time + attackTime + sustainTime)

    let endValue = this.instSettings['BDdec'][0]/100 + 0.001
    Env.gain.linearRampToValueAtTime(
      endValue, 
      time + attackTime + sustainTime + decayTime)

    // Configure output level
    let Level = audioCtx.createGain()
    Level.gain.value = 
      // we keep 0.2 for TOTAL ACCENT
      ((accent) * 0.8 + total_accent*this.instSettings['AC'][0]/1000)
        * this.instSettings['BDlev'][0]/100 * this.#master_gain

    // Connect audio nodes
    soundSource.connect(Env)
    .connect(Level)
    .connect(merger, 0, 0)

    this.#cummulativeGain += Level.gain.value
    soundSource.start(time);
  }
  
  /**
   * Selects the appropriate bass drum sound sample based on instrument settings
   * 
   * @returns {AudioBuffer} The selected bass drum sound buffer
   * @private
   */
  #getBDSound () {
    let returnString = 'B'

    // Add tuning identifier to sample name
    if (this.instSettings['BDtun'][0] <= 30) {
      returnString += 'T0'
    } else if (this.instSettings['BDtun'][0] <= 70) {
      returnString += 'T3'
    } else if (this.instSettings['BDtun'][0] <= 90) {
      returnString += 'T7'
    } else {
      returnString += 'TA'
    }
    returnString += 'A0'

    // Add decay/attack identifier to sample name
    if (this.instSettings['BDdec'][0] === 0) {
      returnString += 'D0'
    } else if (this.instSettings['BDdec'][0] <= 20) {
      returnString += 'D3'
    } else if (this.instSettings['BDdec'][0] <= 70) {
      returnString += 'D7'
    } else {
      returnString = returnString.slice(0, -2) + (this.instSettings['BDatt'][0]>71?'AADA':'A0DA')
    }

    return this.#SoundData[returnString]
  }

  // #showLoader() {
  //   const loader = document.getElementById('loader');
  //   const mainContent = document.getElementById('L3');
    
  //   // Make sure the loader is visible with appropriate opacity
  //   loader.style.opacity = '1';
  //   loader.style.display = 'flex';
  //   loader.style.zIndex = '9999';
  //   loader.style.backgroundColor = 'transparent';
    
  //   // Remove any previous fade-out class
  //   loader.classList.remove('fade-out-loader');
    
  //   // Make the main content visible but with reduced opacity
  //   // This helps with the semi-transparent loader effect
  //   if (mainContent) {
  //     mainContent.style.display = 'block';
  //     mainContent.style.opacity = '0.2';
  //   }
  // }

  #hideLoader() {
    const loader = document.getElementById('loader');
    const mainContent = document.getElementById('L3');
    const appSkin = document.getElementById('app-skin');
  
    
    // Add fade-out class to start the transition
    loader.classList.add('fade-out-loader');
    
    // Wait for the transition to complete before hiding the loader and showing content
    setTimeout(() => {
      // Hide loader
      loader.style.display = 'none';
      loader.style.zIndex = '-1';
      
      // Show main content with fade-in
      if (mainContent) {
        mainContent.style.display = 'block';
        
        // If app skin exists, show it
        if (appSkin) {
          appSkin.style.display = 'block';
        }
        
        // Add slight delay before starting fade-in animation
        setTimeout(() => {
          mainContent.style.opacity = '1';
        }, 50);
      }
    }, 800); // Match this with the CSS transition duration
  }
    

  /** Storage for all drum sound samples */
  #SoundData = []

  /** Callback for load progress updates */
  onLoadProgress = null

  /**
   * Decodes and loads all sound samples from the sound data file
   * 
   * @returns {Promise<boolean|Error>} True if successful, Error object if failed
   * @private
   */
  async decodeSoundData() {
    // this.#showLoader()
    try {
      // Initialize progress tracking
      this.onLoadProgress && this.onLoadProgress(0)
      
      // Fetch sound data - will be served from cache if available via service worker
      const response = await fetch('./sound.tr909data')
      if (!response.ok) {
        throw new Error(`Failed to fetch sound data: ${response.status} ${response.statusText}`)
      }
      
      // Track download progress
      this.onLoadProgress && this.onLoadProgress(10)
      
      // Unzip the blob data
      const blob = await this.#unzipObject(await response.blob())
      this.onLoadProgress && this.onLoadProgress(20)
      
      // Parse the blob text
      const blob_text = await blob.text()
      this.onLoadProgress && this.onLoadProgress(25)
      const parsedBlob = parse(blob_text)
      this.onLoadProgress && this.onLoadProgress(40)
      
      // Decode each audio buffer - use a more efficient approach for Safari
      let objValues, buffer, audioBuffer
      const totalSounds = Object.keys(parsedBlob).length
      let decodedCount = 0
      
      // Process in batches to avoid overwhelming the audio context
      // Safari specifically benefits from not having too many concurrent decodeAudioData calls
      const batchSize = 4; // Process 4 sounds at a time
      const entries = Object.entries(parsedBlob);
      
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        
        // Process batch in parallel
        await Promise.all(batch.map(async ([key, value]) => {
          try {
            objValues = Object.values(value);
            buffer = new Int16Array(objValues);
            
            // Safari has issues with the promise version sometimes, so use the callback pattern if needed
            const isSafari = typeof navigator !== 'undefined' && 
                            navigator.userAgent && 
                            /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                            
            if (isSafari) {
              // Safari-specific implementation with callback fallback
              audioBuffer = await new Promise((resolve, reject) => {
                this.#audioCtx.decodeAudioData(
                  buffer.buffer,
                  (decodedData) => resolve(decodedData),
                  (err) => reject(err)
                );
              });
            } else {
              // Standard promise-based implementation for other browsers
              audioBuffer = await this.#audioCtx.decodeAudioData(buffer.buffer);
            }
            
            this.#SoundData[key] = audioBuffer;
            
            // Update progress (40% to 95% range for decoding)
            decodedCount++;
            const progressPercentage = 40 + Math.floor((decodedCount / totalSounds) * 55);
            this.onLoadProgress && this.onLoadProgress(progressPercentage);
          } catch (err) {
            console.error(`Error decoding audio for ${key}:`, err);
            // Continue with other samples even if one fails
          }
        }));
      }
      
      // Final progress update
      this.onLoadProgress && this.onLoadProgress(100)
      
      this.#hideLoader()
      return true
    } catch (err) {
      console.error('Error loading sound data:', err)
      this.#hideLoader()
      return err
    }
  }  

  /** Master gain level for all sounds */
  #master_gain = 1.0
  
  /** Previous message value for debugging */
  #msg_prev = 0.0

  /**
   * Global mute and solo functionality
   * 
   * The mute and solo bits are stored as 8-bit integers where each bit represents an instrument:
   * channel:bit mapping - BD:7 SD:6 LT:5 MT:4 HT:3 RS-HC:2 HH:1 CY:0
   * 
   * Button IDs are codified as I{number}M for mute and I{number}S for solo to avoid HTML conflicts
   */
  
  /** Stores the mute state for each instrument as bits */
  #muteBits = 0b00000000
  
  /** Stores the solo state for each instrument as bits */
  #soloBits = 0b00000000
  
  /** Controls whether mute/solo button lights should be inverted */
  #muteSoloInvertLights = false
  
  /**
   * Returns whether mute/solo key lights are currently inverted
   * @returns {boolean} True if lights are inverted
   */
  isMuteSoloKeyInverted = () => {return this.#muteSoloInvertLights}

  /**
   * Toggles mute state for all instruments
   * If no instruments are muted, mutes all instruments
   * If any instruments are muted, unmutes them
   * 
   * @param {boolean} invertLightsOnly - If true, only inverts lights without changing state
   */
  setMuteALLorNot (invertLightsOnly=false) {
    this.#muteSoloInvertLights = invertLightsOnly
    let muteKey 
    if (!this.#muteBits) {
      // mute all
      for (let i=0; i<8; i++) {
        muteKey = document.getElementById('I'+i+'M')
        muteKey.click()
      } 
      this.#muteSoloInvertLights = false
      return
    }

    for (let i=0; i<8; i++) {
      // unmute muted
      if (this.#muteBits & 1<<i) {
        muteKey = document.getElementById('I'+i+'M')
        muteKey.click() 
      }
    }
    this.#muteSoloInvertLights = false
  }

  /**
   * Toggles solo state for all instruments
   * If no instruments are soloed, solos all instruments
   * If any instruments are soloed, unsolos them
   * 
   * @param {boolean} invertLightsOnly - If true, only inverts lights without changing state
   */
  setSoloALLorNot (invertLightsOnly=false) {
    this.#muteSoloInvertLights = invertLightsOnly
    let soloKey
    if (!this.#soloBits) {
      // solo all
      for (let i=0; i<8; i++) {
        soloKey = document.getElementById('I'+i+'S')
        soloKey.click()
      } 
      this.#muteSoloInvertLights = false
      return
    }

    for (let i=0; i<8; i++) {
      // unmute muted
      if (this.#soloBits & 1<<i) {
        soloKey = document.getElementById('I'+i+'S')
        soloKey.click() 
      }
    }
    this.#muteSoloInvertLights = false
  }

  /**
   * Toggles the mute state for a specific instrument
   * @param {number} bit - The bit position representing the instrument (0-7)
   */
  setMuteBit (bit) {
    // this.Log('bit:mute:', bit, mute)
    if (!(this.#muteBits & 1<<bit)) {
      this.#muteBits |= 1<<bit // set 0 to 1
      return
    }
    this.#muteBits ^= 1<<bit // set 1 to 0
  }

  /**
   * Toggles the solo state for a specific instrument
   * @param {number} bit - The bit position representing the instrument (0-7)
   */
  setSoloBit (bit) {
    // this.Log('bit:solo:', bit, solo)
    if (!(this.#soloBits & 1<<bit)) {
      this.#soloBits |= 1<<bit
      return
    }
    this.#soloBits ^= 1<<bit 
  }

  /**
   * Determines if an instrument should be played based on mute and solo states
   * @param {number} instrument_bit - The bit position of the instrument
   * @returns {number} 1 if the instrument should be played, 0 otherwise
   * @private
   */
  #getMuteSolo (instrument_bit) {
    // we subtract muteBits from soloBits
    if (this.#soloBits>0) {
      if (((this.#soloBits & 1<<instrument_bit) 
        - (this.#muteBits & 1<<instrument_bit)) > 0) {
          return 1
      }
      return 0
    }
    return !(this.#muteBits & 1<<instrument_bit)
  }

  /** Tracks the cumulative gain for adaptive gain control */
  #cummulativeGain = 0

  /** Stores hihat data for processing */
  #HH = []
  
  /** Compressor for the full audio band */
  #fullBandCompressor = this.#audioCtx.createDynamicsCompressor()
  
  /** Channel merger for combining audio signals */
  #merger = this.#audioCtx.createChannelMerger(1)
  
  /** DC offset filter to remove low frequency artifacts */
  #dcCut = this.#audioCtx.createBiquadFilter()
  
  /** Gain node that adapts to prevent clipping */
  #adaptiveGain = this.#audioCtx.createGain()

  /**
   * Sets Gain Adaptive System parameters based on input level
   * @param {number} a - Input level parameter
   * @private
   */
  #giveGAS(a) {
    a = a?Math.sin(1.1*a*a):0.1
    const time = this.#audioCtx.currentTime
    this.#fullBandCompressor.threshold.setTargetAtTime(a * -35, time, 2)
    this.#fullBandCompressor.attack.setTargetAtTime(Math.tanh(0.125/(a)), time, 2)
    this.#fullBandCompressor.release.setTargetAtTime(Math.tanh(0.060/(a)), time, 2)
  }

  /**
   * Initializes and connects the Gain Adaptive System components
   * @private
   */
  #setGAS() {
    const ct = this.#audioCtx.currentTime
    this.#dcCut.type = "highpass"
    this.#dcCut.frequency.setValueAtTime(20, ct)
    this.#fullBandCompressor = this.#audioCtx.createDynamicsCompressor()
    this.#fullBandCompressor.knee.setValueAtTime(40, ct)
    this.#fullBandCompressor.ratio.setValueAtTime(10, ct)
    this.#adaptiveGain = this.#audioCtx.createGain()
    this.#adaptiveGain.gain.value = 1
    this.#merger
    .connect(this.#fullBandCompressor)
    .connect(this.#adaptiveGain, 0, 0)
    .connect(this.#boost)
    .connect(this.#dcCut)
    .connect(this.#audioCtx.destination)
  }

/** WaveShaper node for adding harmonic distortion */
#boost
/** Curve data for the boost waveshaper */
#boost_curve = new Float32Array(this.#audioCtx.sampleRate)
/** Normalized sample data for processing */
#normalized_samples = new Float32Array(this.#audioCtx.sampleRate)

/**
 * Configures the boost waveshaper with a custom curve
 * @param {number} amount - Amount of boost/distortion (0.0-1.0)
 * @private
 */
#setBoost(amount=0.8) {
    const samples = this.#audioCtx.sampleRate
    const drive = 0.25 * amount + 1.0
    const bias = (0.333+amount/5) * drive
    // this.Log("\n\tboost drive:bias ", drive, bias)
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1.0 // normalize
      this.#boost_curve[i] = Math.atan(drive*x - bias*x*x) + 0.1*drive*2*x
    }
    this.#boost.curve = this.#boost_curve
  }

  // #worker = new Worker('./worker.js')

  /**
   * Plays all instruments for a specific beat based on the pattern
   * @param {number} beatNumber - Current beat number
   * @param {number} time - AudioContext time to schedule the sounds
   * @param {number} flammedTime - Time for flam notes (slightly before main beat)
   * @param {Array} patternPlayed - Pattern data containing instrument triggers
   * @param {AudioContext} audioCtx - Audio context to use
   * @param {ChannelMergerNode} merger - Channel merger node
   * @private
   */
  #playMachine(beatNumber, time, flammedTime, patternPlayed, audioCtx=this.#audioCtx, merger=this.#merger) {
    if (this.#getMuteSolo(7) * patternPlayed[this.#I.BD][beatNumber]) {
      /**
       * Here, if the INST is flammed, it will play one extra before the main time
       */
      if (patternPlayed[15][this.#I.BD]) {
        // for the flammed note we use a sound that is lower in volume than the one played
        // this.Log('flammedTime:', flammedTime)
        this.#playBD(flammedTime, 0.8,
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      // this.Log('time:', time)
      this.#playBD(time, 
        patternPlayed[this.#I.BD][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    if (this.#getMuteSolo(6) * patternPlayed[this.#I.SD][beatNumber]) {
      if (patternPlayed[15][this.#I.SD]) {
        this.#playSD(flammedTime, 0.1,
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playSD(time, 
        patternPlayed[this.#I.SD][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    if (this.#getMuteSolo(5) * patternPlayed[this.#I.LT][beatNumber]) {
      if (patternPlayed[15][this.#I.LT]) {
        this.#playTom('L', flammedTime, 0.8,
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playTom('L', time, 
        patternPlayed[this.#I.LT][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }
    if (this.#getMuteSolo(4) * patternPlayed[this.#I.MT][beatNumber]) {
      if (patternPlayed[15][this.#I.MT]) {
        this.#playTom('M', flammedTime, 0.8,
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playTom('M', time, 
        patternPlayed[this.#I.MT][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }
    if (this.#getMuteSolo(3) * patternPlayed[this.#I.HT][beatNumber]) {
      if (patternPlayed[15][this.#I.HT]) {
        this.#playTom('H', flammedTime, 0.8,
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playTom('H', time, 
        patternPlayed[this.#I.HT][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    if (this.#getMuteSolo(2) * patternPlayed[this.#I.RS][beatNumber]) {
      if (patternPlayed[15][this.#I.RS]) {
        this.#playRim(flammedTime,
          patternPlayed[this.#I.RS][beatNumber],
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playRim(time,
        patternPlayed[this.#I.RS][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    if (this.#getMuteSolo(2) * patternPlayed[this.#I.HC][beatNumber]) {
      if (patternPlayed[15][this.#I.HC]) {
        this.#playHClap(flammedTime,
          patternPlayed[this.#I.HC][beatNumber],
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playHClap(time,
        patternPlayed[this.#I.HC][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    // closed and open hi-hats sit on the same track
    if (this.#getMuteSolo(1) * patternPlayed[this.#I.HHC][beatNumber]) {
      let accent = 0
      let name_ = ''
      switch (patternPlayed[this.#I.HHC][beatNumber]) {
        case 1:
          accent = 0.6
          name_ = 'C'
          this.#HH = this.#getHatSound(name_); break
        case 2:
          accent = 0.8
          name_ = 'C'
          this.#HH = this.#getHatSound(name_); break
        case 3:
          accent = 0.6
          name_ = 'O'
          this.#HH = this.#getHatSound(name_); break
        case 6:
          accent = 0.8
          name_ = 'O'
          this.#HH = this.#getHatSound(name_); break
      }

      if (patternPlayed[15][this.#I.HHC]===1&&name_!=='O') {
        this.#playHats(flammedTime, accent,
          patternPlayed[this.#I.AC][beatNumber], this.#HH, undefined, audioCtx, merger
        )
      } else if (patternPlayed[15][this.#I.HHC]===2&&name_!=='C') {
        this.#playHats(flammedTime, accent-0.2,
          patternPlayed[this.#I.AC][beatNumber], this.#HH, undefined, audioCtx, merger
        )
      } else if (patternPlayed[15][this.#I.HHC]===3) {
        this.#playHats(flammedTime, accent,
          patternPlayed[this.#I.AC][beatNumber], this.#HH, undefined, audioCtx, merger
        )
      }

      this.#playHats(time, accent,
        patternPlayed[this.#I.AC][beatNumber], this.#HH, undefined, audioCtx, merger)
    }

    if (this.#getMuteSolo(0) * patternPlayed[this.#I.RD][beatNumber]) {
      if (patternPlayed[15][this.#I.RD]) {
        this.#playRide(flammedTime,
          patternPlayed[this.#I.RD][beatNumber],
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playRide(time,
        patternPlayed[this.#I.RD][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    if (this.#getMuteSolo(0) * patternPlayed[this.#I.CR][beatNumber]) {
      if (patternPlayed[15][this.#I.CR]) {
        this.#playCrash(flammedTime,
          patternPlayed[this.#I.CR][beatNumber],
          patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
      }
      this.#playCrash(time,
        patternPlayed[this.#I.CR][beatNumber],
        patternPlayed[this.#I.AC][beatNumber], audioCtx, merger)
    }

    
  }

  /**
   * Renders the current pattern sequence to a WAV file
   * Creates an offline audio context, processes all patterns in the queue,
   * and generates a downloadable WAV file
   * @returns {Promise<void>}
   */
  async renderMachine() {
    const getGrid = (scale) => {
      switch (scale) {
        case 1:
          return 4
        case 2:
          return 8
        case 3:
          return 3
        case 4:
          return 6
      }
    }

    let secondsPerBeat = 0
    let totalBeats = 0
    let totalSeconds = 0
    let patternPlayed = []
    let firstBeat = 0
    let base = 0
    let beatsPerPattern = 0
    let scale = 0
    for (let i = 0; i < this.#playbackQueue.length; i++) {
      patternPlayed = this.#memory[this.#getPatternMemoryLocation(this.#playbackQueue[i])]
      firstBeat = patternPlayed[16]
      base = patternPlayed[12]
      beatsPerPattern = base - firstBeat
      scale = patternPlayed[11]
      totalBeats += beatsPerPattern
      secondsPerBeat = 60 / (this.#giveTempo() * getGrid(scale))
      totalSeconds += beatsPerPattern * secondsPerBeat
      // this.Log('beatsPerPattern:', beatsPerPattern, firstBeat, base)
    }
    // this.Log('totalBeats:', totalBeats)
    // this.Log('totalSeconds:', totalSeconds)

    // we add 4 beats to the total seconds to avoid cutting the last note
    const offlineCtx = new OfflineAudioContext(1, (totalSeconds + 4 * secondsPerBeat) * this.#audioCtx.sampleRate, this.#audioCtx.sampleRate)

    const merger = offlineCtx.createChannelMerger(1)
    const fullBandCompressor = offlineCtx.createDynamicsCompressor()
    fullBandCompressor.threshold.value = this.#fullBandCompressor.threshold.value
    fullBandCompressor.attack.value = this.#fullBandCompressor.attack.value
    fullBandCompressor.release.value = this.#fullBandCompressor.release.value
    fullBandCompressor.knee.value = this.#fullBandCompressor.knee.value
    fullBandCompressor.ratio.value = this.#fullBandCompressor.ratio.value

    const adaptiveGain = offlineCtx.createGain()
    adaptiveGain.gain.value = this.#adaptiveGain.gain.value

    const boost = offlineCtx.createWaveShaper()
    boost.curve = this.#boost.curve
    const dcCut = offlineCtx.createBiquadFilter()
    dcCut.type = 'highpass'
    dcCut.frequency.value = this.#dcCut.frequency.value

    merger.connect(fullBandCompressor)
    .connect(adaptiveGain, 0, 0)
    .connect(boost)
    .connect(dcCut)
    .connect(offlineCtx.destination)

    let shuffleFactor = 0
    let flamFactor = 0
    let invert = 0
    let nextNoteTime = 0
    let flammedTime = 0
    for (let i = 0; i < this.#playbackQueue.length; i++) {
      patternPlayed = this.#memory[this.#getPatternMemoryLocation(this.#playbackQueue[i])]
      firstBeat = patternPlayed[16]
      base = patternPlayed[12]
      beatsPerPattern = base - firstBeat
      scale = patternPlayed[11]
      shuffleFactor = patternPlayed[13]
      flamFactor = patternPlayed[14]
      invert = patternPlayed[17]

      secondsPerBeat = 60 / (this.#giveTempo() * getGrid(scale))

      // the standard practice is to not put the flammed note into a very first beat
      // it will screw up the timing
      for (let beatNumber = !invert?firstBeat:base-1; 
        !invert?beatNumber < base:beatNumber >= firstBeat; 
        !invert?beatNumber++:beatNumber--) {
        // this.Log('beatNumber:nextNoteTime:flammedTime:', beatNumber, nextNoteTime, flammedTime)

        this.#playMachine(beatNumber, nextNoteTime, flammedTime, patternPlayed, offlineCtx, merger)

        secondsPerBeat = beatNumber%2==-0?
        secondsPerBeat + shuffleFactor*secondsPerBeat:
        secondsPerBeat - shuffleFactor*secondsPerBeat
        nextNoteTime += secondsPerBeat

        flammedTime = nextNoteTime - (flamFactor+0.21)*secondsPerBeat

      }
      
    }
    const renderedBuffer = await offlineCtx.startRendering()
    const wavBlob = this.#audioBufferToWAV(renderedBuffer)
    const url = URL.createObjectURL(wavBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${this.getCurrentPresetName()}-${this.#giveTempo()}bpm.wav`
    a.click()
  }

  /**
   * Converts an AudioBuffer to a WAV file blob
   * @param {AudioBuffer} buffer - The audio buffer to convert
   * @returns {Blob} A blob containing the WAV file data
   * @private
   */
  #audioBufferToWAV(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bitDepth = 16;
  
    // Calculate the size of the WAV file
    const wavHeaderSize = 44;
    const dataSize = length * numChannels * (bitDepth / 8);
    const totalSize = wavHeaderSize + dataSize;
  
    // Create an ArrayBuffer to hold the WAV file
    const wavArray = new ArrayBuffer(totalSize);
    const view = new DataView(wavArray);
  
    // Write the WAV header
    // "RIFF" chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true); // byte rate
    view.setUint16(32, numChannels * (bitDepth / 8), true); // block align
    view.setUint16(34, bitDepth, true);
    
    // "data" sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write the audio data
    const offset = 44;
    const channelData = [];
    
    // Get audio data for each channel
    for (let channel = 0; channel < numChannels; channel++) {
      channelData.push(buffer.getChannelData(channel));
    }
    
    // Convert Float32 audio data to Int16
    let dataIndex = 0;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        // Convert to 16-bit signed int
        const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + dataIndex, int16Sample, true);
        dataIndex += 2; // 16 bits = 2 bytes
      }
    }
    
    // Helper function to write strings to the buffer
    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
    
    return new Blob([wavArray], { type: 'audio/wav' });
  }

  /**
   * Schedules and plays all instruments based on the current pattern
   * @param {number} beatNumber - Current beat number in the pattern
   * @param {number} time - Scheduled time to play the note
   * @param {number} flammedTime - Time for flam notes (slightly before the main beat)
   * @private
   */
  #scheduleNote = async (beatNumber, time, flammedTime) => {
    // Fade out main keys when starting from the first beat
    this.#beatRunnerCounter===this.firstBeat&&this.#fadeOutMainKeysForNewBASE()
    
    // Set master gain from volume wheel setting
    this.#master_gain = this.instSettings['volume_wheel'][0]/100.0
    if (this.#master_gain != this.#msg_prev) {
      this.#giveGAS(this.#master_gain)
      this.#setBoost(this.#master_gain)
      this.#msg_prev = this.#master_gain
    }

    // Play metronome click if guide is enabled and we're on a grid beat
    if (this.#guide && this.#beatRunnerCounter % (this.#grid) === 0) {
      this.#playClick(time)
    }
    
    // this.Log(
    //   'SOUND:   beatRunnerCounter:BASE', beatNumber, this.BASE,
    //   'patNum:', this.#patternNumber,
    //   'pattern:', this.#playbackQueue[this.#patternNumber],
    //   'patLocation:', this.#patternLocation,
    //   'currentCode:', this.#currentQTSlot,
    //   'selectorCODE:', this.SELECTOR_CODE)
    
    // Get the pattern to be played from memory
    let patternPlayed = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)]

    // Play all instruments according to the pattern
    this.#playMachine(beatNumber, time, flammedTime, patternPlayed)
    
    // Apply adaptive gain to prevent clipping when multiple instruments play simultaneously
    if (this.#cummulativeGain > 1) {
      const delta = 1 / Math.pow(10, this.#cummulativeGain/20)
      this.#adaptiveGain.gain.setTargetAtTime(delta, time, 2)
    } else {
      this.#adaptiveGain.gain.setTargetAtTime(1, time, 2)
    }

    // Reset cumulative gain for next beat
    this.#cummulativeGain = 0.0
  }

  /** Array to store volume IDs */
  #volumeID = new Array(20)
  
  /**
   * Advances to the next pattern in the queue when current pattern finishes
   * @param {number} beatNumber - Current beat number
   * @private
   */
  #moveToNextPattern (beatNumber) {
    // Only move to next pattern when we reach the end of the current pattern
    if (beatNumber===(!this.invert?this.BASE-1:this.firstBeat)) {

      // Handle case where pattern was deleted
      if (!this.#playbackQueue[this.#patternNumber]) {
        this.#patternNumber = 0
      // Advance to next pattern in queue unless editing is in progress
      } else if (!this.TRACK_WRITE + this.isBankTable + this.isQueueTable) {
        this.#patternNumber = (this.#patternNumber + 1) % this.#playbackQueue.length  
      }
      
      // Update pattern location and UI
      this.#patternLocation = this.#playbackQueue[this.#patternNumber]
      
      this.switchQTSlot(this.#patternNumber)
      this.changePattern(this.#patternLocation[3], this.#patternLocation)

      // this.Log('playedPattern:', this.#patternLocation)
    }
  }

  /** Shuffle factor for timing variation (0.0 = no shuffle) */
  #shuffleFactor = 0.0
  
  /** Controls swing intensity - higher values = softer swing */
  #swingFactor = 31
  
  /** Flam factor for timing variation (0.0 = no flam) */
  #flamFactor = 0.0
  
  /** Controls spread between flammed notes in milliseconds */
  #flamSpread = 20

  /** How frequently to call scheduling function (in milliseconds) */
  #lookahead = 20.0;
  
  /** How far ahead to schedule audio (sec) */
  #scheduleAheadTime = 0.080;
  
  /**
   * Resets timing and pattern parameters to default values
   * @param {boolean} init - Whether this is an initialization call
   * @returns {boolean} Always returns true
   * @private
   */
  #resetBaseScaleOthers (init=false) {
    this.#GLOBAL_SCALE = 1
    this.#shuffleFactor = 0.0
    this.#swingFactor = 31
    this.#flamFactor = 0.0
    this.#flamSpread = 20
    this.flammedTime = 0
    this.BASE = 16
    this.#grid = 4
    this.firstBeat = 0
    this.invert = 0
    
    return true
  }

  /**
   * Main scheduler function that recursively schedules notes ahead of time
   * Uses a look-ahead algorithm to ensure smooth playback
   * @private
   */
  #scheduler = () => {
    // Schedule notes that need to play before the next interval
    while (this.nextNoteTime < this.#audioCtx.currentTime + this.#scheduleAheadTime) {
      // Move beat counter forward or backward depending on direction
      !this.invert?this.#moveBeatRunner():this.#moveBeatRunnerBackward()

      /* Handle end of sequence when not in cycle mode */
      if (this.#patternNumber===this.#playbackQueue.length-1
        &&!this.#CYCLE&&this.#beatRunnerCounter===(!this.invert?this.BASE-1:this.firstBeat)) {
        // Play the last note of the last pattern before stopping
        this.#scheduleNote(this.#beatRunnerCounter, this.nextNoteTime, this.flammedTime)
        this.StateSetters['handleClickMk']('STOP')
        return
      }
      
      // Schedule the current note
      this.#scheduleNote(this.#beatRunnerCounter, this.nextNoteTime, this.flammedTime)
      
      // Calculate time between beats based on tempo and grid
      let secondsPerBeat = 60.0 / (this.#giveTempo()*this.#grid)

      // this.Log('--------> grid:', this.#grid)
      
      /**
       * Apply shuffle by adding time to even beats and subtracting from odd beats
       * This creates a swing feel that works in any scale or base
       */
      secondsPerBeat = this.#beatRunnerCounter%2==0?
        secondsPerBeat + this.#shuffleFactor*secondsPerBeat:
        secondsPerBeat - this.#shuffleFactor*secondsPerBeat

      // Add beat duration to schedule next note
      this.nextNoteTime += secondsPerBeat;

      /**
       * Calculate flam timing based on pattern settings
       * Flam creates a grace note slightly before the main note
       */
      let FLAM = this.#memory[this.#getPatternMemoryLocation(this.#patternLocation)][14]

      // 0.21 is a small correction factor that may need tuning
      this.flammedTime = this.nextNoteTime - (FLAM+0.21)*secondsPerBeat
       
      // this.Log('shuffleFactor:time:time added:', 
      //   this.#shuffleFactor, secondsPerBeat, this.#shuffleFactor*secondsPerBeat)
    }
    
    // Schedule next call to this function
    this.timerID = setTimeout(this.#scheduler, this.#lookahead)
  }

  /** Table of playback control functions */
  #playbackTable = []
  
  /**
   * Initializes the playback control functions table
   * Sets up START, STOP, and CONT (continue) functions
   * @private
   */
  #createPlaybackTable = () => {
    // Initialize required state setters
    this.StateSetters['setBeatLightBlink'] = () => {}
    this.StateSetters['QTa0'] = () => {}

    // Define START function - begins playback from current position
    this.#playbackTable['START'] = async () => {
      clearTimeout(this.timerID)
      this.stopBeatBlinking()

      // Resume audio context if suspended
      if (this.#audioCtx.state === "suspended") {
        this.#audioCtx.resume();
      }

      // Initialize beat counter based on playback direction
      this.#beatRunnerCounter = !this.invert?this.firstBeat-1:this.BASE

      // Start scheduling from current time
      this.nextNoteTime = this.#audioCtx.currentTime
      this.#scheduler()

      // this.Log('   \n>>>PLAYBACK>>>:', 'START:beatRunner:', this.#beatRunnerCounter)
    }

    // Define STOP function - halts playback
    this.#playbackTable['STOP'] = () => {
      clearTimeout(this.timerID)
      this.startBeatBlinking()
      // this.Log(`  >>>PLAYBACK>>>:', 'STOP
      //   beatRunnerCounter: ${this.#beatRunnerCounter}
      //   BASE: ${this.BASE}
      //   firstBeat: ${this.firstBeat}
      // `)
    }

    // Define CONT function - continues playback from where it was stopped
    this.#playbackTable['CONT'] = async () => {
      // this.Log('   >>>PLAYBACK>>>:', 'CONT')
      this.stopBeatBlinking()

      // Resume audio context if suspended
      if (this.#audioCtx.state === "suspended") {
        this.#audioCtx.resume();
      }

      // Handle case where machine was reloaded
      if (!this.nextNoteTime) {
        this.#beatRunnerCounter = !this.invert?this.firstBeat-1:this.BASE
      }
      
      // Ensure beat counter is within valid range
      if (this.#beatRunnerCounter < this.firstBeat || 
        this.#beatRunnerCounter > this.BASE
      ) { this.#beatRunnerCounter = !this.invert?this.firstBeat-1:this.BASE }

      // Start scheduling from current time
      this.nextNoteTime = this.#audioCtx.currentTime
      this.#scheduler()

      // this.Log('   >>>PLAYBACK>>>:', 'STOP')
    }
  }

  /**
   * Executes a playback command (START, STOP, or CONT)
   * @param {string} payload - The command to execute
   * @private
   */
  #playback(payload) { 
    this.#playbackTable[payload]()
  }
  
  /**
   * Generates an empty preset with default settings
   * @returns {Array} An array containing:
   *   [0] - Empty sound data array
   *   [1] - Default pattern queue with one pattern
   *   [2] - Default machine settings for all instruments
   *   [3] - Display parameters
   *   [4] - Mute bits (0 = none muted)
   *   [5] - Solo bits (0 = none soloed)
   *   [6] - CYCLE mode (false = off)
   *   [7] - Quantize mode (false = off)
   *   [8] - Preset name ("init")
   */
  #generateEmptyPreset = () => {
    return [
      [], // sound data
      [['B1', 'T1', 'PG1', 0]], // patternQueue
      { // machine settings
        "BDtun": [ 50, 0, {} ], "BDlev": [ 50, 0, {} ], 
        "SDtun": [ 50, 0, {} ], "SDlev": [ 50, 0, {} ],
        "LTtun": [ 50, 0, {} ], "LTlev": [ 50, 0, {} ],
        "MTtun": [ 50, 0, {} ], "MTlev": [ 50, 0, {} ],
        "HTtun": [ 50, 0, {} ], "HTlev": [ 50, 0, {} ],
        "RSlev": [ 50, 0, {} ],
        "HClev": [ 50, 0, {} ], "HHlev": [ 50, 0, {} ],
        "CRlev": [ 50, 0, {} ],
        "RDlev": [ 50, 0, {} ],
        "AC": [ 0, -150, {} ],
        "BDatt": [ 50, 0, {} ], "BDdec": [ 50, 0, {} ],
        "SDton": [ 50, 0, {} ], "SDsna": [ 50, 0, {} ],
        "LTdec": [ 50, 0, {} ], "MTdec": [ 50, 0, {} ], "HTdec": [ 50, 0, {} ],
        "CHdec": [ 50, 0, {} ], "OHdec": [ 50, 0, {} ],
        "CRtun": [ 50, 0, {} ], "RDtun": [ 50, 0, {} ],
        "tempo_wheel": [ 118, 0, {} ], "volume_wheel": [ 80, 90, {} ]
      },
      [1, 1, 0], // Display bottom-right parameters
      0, // muteBits
      0, // soloBits
      false, // CYCLE
      false, // quantize
      "init" // preset's name
    ]
  }

  /**
   * Generates an empty pattern with default settings
   * @returns {Array} An array containing pattern data and settings
   */
  #generateEmptyPattern = () => {
    let p = Array.from(
      {length: 11}, () => new Uint8Array(16).fill(0))

      // Additional variables also used per pattern.
      p[11] = 1 // this.#GLOBAL_SCALE
      p[12] = 16 // this.BASE
      p[13] = 0.0 // this.#shuffleFactor
      p[14] = 0.0 // this.#flamFactor

      // Instruments that are flammed have 1 as their true variable.
      // Exception is HHC and HHO, the have 1, 2, and 3 (both are set)
      // Layout conforms with #I's layout.
      p[15] = Uint8Array.from("00000000000") // flammed instruments
      p[16] = 0 // this.firstBeat
      p[17] = 0 // this.invert
      return p
  }

  /**
   * Generates the entire memory space for patterns
   * @returns {Array} An array of 384 empty patterns
   */
  #generateMemory () {
    const memory = Array.from({length: 384}, () => this.#generateEmptyPattern())
    return memory
  }

  /**
   * Lookup table for memory location codes
   * Maps bank (B1, B2), track (T1-T4), and pattern group (PG1-PG3) to memory offsets
   */
  #memoryCodes = {
    B1: 0, B2: 192, 
    T1: 0, T2: 48, T3: 96, T4: 144,
    PG1: 0, PG2: 16, PG3: 32
  }

  /**
   * Calculates the memory index for a specific pattern
   * @param {Array} SELECTOR_CODE - Array containing [bank, track, pattern group, pattern number]
   * @returns {number} Memory index of the pattern
   */
  #getPatternMemoryLocation (SELECTOR_CODE) {
    return this.#memoryCodes[SELECTOR_CODE[0]] 
    + this.#memoryCodes[SELECTOR_CODE[1]] 
    + this.#memoryCodes[SELECTOR_CODE[2]] 
    + SELECTOR_CODE[3]
  }

  /**
   * Calculates the memory index for a pattern group
   * @param {Array} SELECTOR_CODE - Array containing [bank, track, pattern group]
   * @returns {number} Memory index of the pattern group
   */
  #getPatternGroupLocation (SELECTOR_CODE) {
    return this.#memoryCodes[SELECTOR_CODE[0]]
    + this.#memoryCodes[SELECTOR_CODE[1]]
    + this.#memoryCodes[SELECTOR_CODE[2]] 
  }
  
  /**
   * Returns the current memory state
   * @returns {Array} The current memory
   */
  #getMemory() { return this.#memory }

  /**
   * Sets the memory state from a preset
   * @param {Array} newState - The preset to load
   * @param {boolean} [init=false] - Whether this is an initialization (clean load)
   * @param {boolean} [setName=true] - Whether to update the preset name in the display
   */
  #setMemory(newState, init=false, setName=true) { 
    // this.Log("setMemory");
    
    // Reset memory with fresh empty patterns
    this.#memory = this.#generateMemory();

    // Update preset name in UI if requested
    if (setName && newState[8]) {
      this.StateSetters['sbPreset'](newState[8]);
    }

    // Load pattern data if preset contains patterns
    if (newState[0] && newState[0].length > 0) {
      this.#loadPatternData(newState[0]);
    } else { 
      // For empty presets, ensure first beat is set to zero
      // [1][0][3] refers to the pattern number in the playbackQueue
      this.#memory[newState[1][0][3]][16] = 0;
    }

    // Set up playback queue
    this.#setupPlaybackQueue(newState, init);
    
    // Set current selector code and initialize pattern
    this.SELECTOR_CODE = this.#playbackQueue[0];
    this.changePattern(this.SELECTOR_CODE[3], this.SELECTOR_CODE, true);
    this.switchQTSlot(0);

    // Update beat runner light position based on play mode
    this.#updateBeatRunnerLight();

    // Update instrument settings and UI controls
    this.#updateInstrumentSettings(newState);

    // Update mute/solo states
    this.#updateMuteSoloStates(newState);

    // Update CYCLE and quantize states
    this.#updateCycleAndQuantize(newState);

    // Ensure queue table visibility matches queue state
    this.#updateQueueTableVisibility();
  }

  /**
   * Loads pattern data from a preset into memory
   * @param {Array} patternData - Array of patterns from the preset
   * @private
   */
  #loadPatternData(patternData) {
    for (let k = 0; k < patternData.length; k++) {
      const patternIdx = patternData[k][0];
      const pattern = patternData[k][1];
      
      // Load instrument data (11 instruments)
      for (let inst = 0; inst < 11; inst++) {
        this.#memory[patternIdx][inst] = Uint8Array.from(Object.values(pattern[inst]));
      }
      
      // Load pattern settings
      this.#memory[patternIdx][11] = pattern[11]; // SCALE
      this.#memory[patternIdx][12] = pattern[12]; // BASE (last step)
      this.#memory[patternIdx][13] = pattern[13]; // shuffleFactor
      this.#memory[patternIdx][14] = pattern[14]; // flamFactor
      this.#memory[patternIdx][15] = Uint8Array.from(Object.values(pattern[15])); // flammed instruments
      this.#memory[patternIdx][16] = pattern[16]; // firstBeat
      this.#memory[patternIdx][17] = pattern[17]; // invert
    }
  }

  /**
   * Sets up the playback queue from a preset
   * @param {Array} newState - The preset data
   * @param {boolean} init - Whether this is an initialization
   * @private
   */
  #setupPlaybackQueue(newState, init) {
    this.#playbackQueue.length = 0;
    
    if (!init && newState[1]) {
      // Copy pattern queue from preset
      for (let i = 0; i < newState[1].length; i++) {
        this.#playbackQueue.push(newState[1][i].slice());
      }
    } else {
      // Initialize with default pattern
      this.#playbackQueue[0] = ["B1", "T1", "PG1", 0];
    }
  }

  /**
   * Updates the beat runner light position based on current play mode
   * @private
   */
  #updateBeatRunnerLight() {
    this.firstBeat = this.#memory[this.#getPatternMemoryLocation(this.SELECTOR_CODE)][16];
    const position = !this.invert ? 
      (88 + this.firstBeat * 79) : 
      (88 + (this.BASE-1) * 79);
    
    this.StateSetters['setBeatLightX'](position);
  }

  /**
   * Updates instrument settings and rotary knobs from preset data
   * @param {Array} newState - The preset data
   * @private
   */
  #updateInstrumentSettings(newState) {
    // Update rotary knobs for instrument settings
    if (newState[2]) {
      const knobParams = Object.keys(this.instSettings);
      
      for (const knobParamKey of knobParams) {
        if (!newState[2][knobParamKey]) break;
        
        // Update position, value and trigger UI update
        this.instSettings[knobParamKey][0] = newState[2][knobParamKey][0];
        this.instSettings[knobParamKey][1] = newState[2][knobParamKey][1];
        this.instSettings[knobParamKey][2](this.instSettings[knobParamKey][1]);
      }
    }

    // Update LED display with queue information
    if (newState[3]) {
      this.StateSetters['setQueueLen'](newState[3][0]);
      this.StateSetters['setLastPat'](newState[3][1]);
      this.StateSetters['setSelectedQTSlot'](newState[3][2] + 1);
    }
  }

  /**
   * Updates mute and solo states from preset data
   * @param {Array} newState - The preset data
   * @private
   */
  #updateMuteSoloStates(newState) {
    // Clear current mute/solo states
    if (this.#muteBits) this.setMuteALLorNot();
    if (this.#soloBits) this.setSoloALLorNot();
    
    // Set new states
    this.#muteBits = newState[4];
    this.#soloBits = newState[5];
    
    // Update UI if needed
    if (this.#muteBits) this.setMuteALLorNot(true);
    if (this.#soloBits) this.setSoloALLorNot(true);
  }

  /**
   * Updates cycle and quantize settings from preset data
   * @param {Array} newState - The preset data
   * @private
   */
  #updateCycleAndQuantize(newState) {
    // CYCLE mode (toggle if needed)
    if (!this.#CYCLE && newState[6]) this.#NO_SHIFT_TABLE['CG']('CG');
    if (this.#CYCLE && !newState[6]) this.#NO_SHIFT_TABLE['CG']('CG');
    
    // Quantize mode (toggle if needed)
    if (!this.#quantize && newState[7]) this.#SHIFT_TABLE['Q']('Q');
    if (this.#quantize && !newState[7]) this.#SHIFT_TABLE['Q']('Q');
  }

  /**
   * Ensures queue table visibility matches queue state
   * If the application has been reloaded, this method toggles the queue table
   * visibility twice to refresh its state correctly
   * @private
   */
  #updateQueueTableVisibility() {
    if (this.isReloaded) {
      // Click twice to toggle and restore the queue table to proper state
      document.getElementById('sbPreset').click();
      document.getElementById('sbPreset').click();
    }
  }

  /** Stores touch events */
  touches = undefined
  
  /** Array to store input form timeout IDs */
  #inputFormId = []
  
  /** Tracks input form leave state and current preset */
  handleInputFormLeaveL1 = [false, this.currentPreset]
  
  /** Stores the previous preset ID for comparison */
  previousPresetId = this.currentPreset

  /**
   * Sets a timeout to hide an input form
   * @param {string} setterAddress - The state setter to call when timeout completes
   */
  handleInputFormLeave = (setterAddress) => {
    this.#inputFormId[setterAddress] = (setTimeout(() => {
      this.StateSetters[setterAddress](false)
    }, 1500))
  }
  
  /**
   * Clears the timeout for hiding an input form
   * @param {string} setterAddress - The state setter whose timeout should be cleared
   */
  clearInputFormLeave (setterAddress) {
    clearTimeout(this.#inputFormId[setterAddress])
  }
  
  /**
   * Handles keyboard input for controlling the drum machine
   * @param {KeyboardEvent} e - The keyboard event
   * @param {boolean} [keyUp=false] - Whether this is a keyup event
   */
  consumePressedKey (e, keyUp=false) {
    // this.Log('consumePressedKey:', e)
    // this.Log("isPresetNameChange:", this.isPresetNameChange, this.isBankNameChange)
    if (this.isPresetNameChange | this.isBankNameChange) {
      return
    }

    if (!keyUp) {
      switch (e.code) {
        // MainKeys
        case 'Space':
          e.preventDefault()
          this.handleClickMk('STOP')
          break

        case 'Enter':
          e.preventDefault();
          this.handleClickMk('START')

          break 
        case 'Digit1':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(0)
          break 
        case 'KeyQ':
          e.preventDefault();
          this.handleClickMk(1)
          break 
        case 'Digit2':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(2)
          break
        case 'KeyW':
          e.preventDefault();
          this.handleClickMk(3)
          break
        case 'Digit3':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(4)
          break 
        case 'KeyE':
          e.preventDefault();
          this.handleClickMk(5)
          break 
        case 'Digit4':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(6)
          break 
        case 'KeyR':
          e.preventDefault();
          this.handleClickMk(7)
          break
        case 'Digit5':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(8)
          break 
        case 'KeyT':
          e.preventDefault();
          this.handleClickMk(9)
          break
        case 'Digit6':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(10)
          break
        case 'KeyY':
          e.preventDefault();
          this.handleClickMk(11)
          break
        case 'Digit7':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(12)
          break 
        case 'KeyU':
          e.preventDefault();
          this.handleClickMk(13)
          break
        case 'Digit8':
          this.#altKey = e.altKey
          e.preventDefault();
          this.handleClickMk(14)
          break 
        case 'KeyI':
          e.preventDefault();
          this.handleClickMk(15) 
          break

        // LedKeys
        case 'ShiftLeft':
        case 'ShiftRight':
          e.preventDefault();
          this.StateSetters['handleClickSHIFT'](); break
        case 'KeyZ':
          e.preventDefault();
          document.getElementById('INST SELECT').click(); break
        case 'KeyM':
          e.preventDefault();
          document.getElementById('TEMPO-STEP').click(); break
        case 'Comma':
          e.preventDefault();
          document.getElementById('BACK-TAP').click(); break
        case 'Period':
          e.preventDefault();
          document.getElementById('B1').click(); break
        case 'KeyG':
          e.preventDefault();
          document.getElementById('CG').click(); break
        case 'Backspace':
          e.preventDefault();
          document.getElementById('TS-PM').click(); break

        // mute keys
        case 'KeyA':
          e.preventDefault()
          e.altKey?document.getElementById('I7S').click():document.getElementById('I7M').click()
          break
        case 'KeyS':
          e.preventDefault()
          e.altKey?document.getElementById('I6S').click():document.getElementById('I6M').click()
          break
        case 'KeyD':
          e.preventDefault()
          e.altKey?document.getElementById('I5S').click():document.getElementById('I5M').click()
          break
        case 'KeyF':
          e.preventDefault()
          e.altKey?document.getElementById('I4S').click():document.getElementById('I4M').click()
          break
        case 'KeyH':
          e.preventDefault()
          e.altKey?document.getElementById('I3S').click():document.getElementById('I3M').click() 
          break
        case 'KeyJ':
          e.preventDefault()
          e.altKey?document.getElementById('I2S').click():document.getElementById('I2M').click()
          break
        case 'KeyK':
          e.preventDefault()
          e.altKey?document.getElementById('I1S').click():document.getElementById('I1M').click()
          break
        case 'KeyL':
          e.preventDefault()
          e.altKey?document.getElementById('I0S').click():document.getElementById('I0M').click()
          break
        case 'KeyB':
          e.preventDefault()
          document.getElementById('sbBank').click(); break  
        case 'KeyP':
          e.preventDefault()
          document.getElementById('sbPreset').click(); break

        default: break 
      }
    }
  }

  /**
   * --- COLORS related functionality ---
   */
  
  /** Minimum value for hue range in color generation */
  hueRangeMin = 85
  
  /** Maximum value for hue range in color generation */
  hueRangeMax = 130
  
  /** Default background color for fixed elements */
  fixedBackgroundColor = "rgb(219, 219, 219)"
  
  /** Secondary background color for fixed elements */
  fixedBackgroundColor2 = "hsl(0, 0.0%, 57%)"
  
  /** Current background color of the body element */
  currentBodyColor = "hsl(0, 0%, 62%)"
  
  /** Current font color used in the interface */
  currentFontColor = "hsl(19, 100%, 100%)"
  
  /** Conic gradient definition for Bank/Queue Table component */
  BQTConicGradient = `conic-gradient(from 0.83turn at 42% 290%,
  ${this.fixedBackgroundColor2} 0%,
  rgba(90, 85, 96, 0) 19%, 
  ${this.fixedBackgroundColor2} 33%)`
  
  /** Current value for hue range variable, controls color scheme */
  hueRangeVar = 128
  
  /**
   * Generates a linear gradient color bar based on hue range settings
   * Used for color selection UI
   * @returns {string} CSS linear-gradient definition
   * @private
   */
  #generateHueBar = () => {
    let linear_gradient = "linear-gradient(to right,"
    for (let hue=this.hueRangeMin; hue<=this.hueRangeMax;) {
      let x = hue>220?3.3+hue/100:3.3
      let sat = Math.abs(Math.cos(hue/100))*100/(62-(hue-41)/x)
      let lum = Math.abs(Math.cos(hue/100))*100
      
      let hsl_string = `hsl(
        ${hue*sat*0.3678794412}, 
        ${sat}%, 
        ${lum}%)`
      
      linear_gradient += hsl_string + ',' 
      hue += 20
    }
    linear_gradient = linear_gradient.slice(0, -1)
    linear_gradient += ")"
    return linear_gradient
  }

  /** Cached CSS rule for preset slot styling */
  #gotPresetSlotCSS = ""
  
  /**
   * Retrieves CSS rule for a specific element by selector
   * @param {string} css_element_name - CSS selector to find
   * @returns {CSSStyleRule} The CSS rule for the specified selector
   */
  getPresetSlotCSS = (css_element_name) => {
    // if (this.#gotPresetSlotCSS !== "") { return this.#gotPresetSlotCSS}

    const stylesheet = document.styleSheets[0];

    for(let i = 0; i < stylesheet.cssRules.length; i++) {
      if(stylesheet.cssRules[i].selectorText === css_element_name) {
        this.#gotPresetSlotCSS = stylesheet.cssRules[i];
        break
      }
    }
    return this.#gotPresetSlotCSS
  }
  
  /** ID for localStorage operations */
  #localStorageID
  
  /** Counter for wheel load operations */
  wheelLoadCounter = 0
  
  /**
   * Retrieves the last active wheel from localStorage
   * @returns {string|null} Last active wheel ID or null if not found
   */
  getLastActiveWheelFromLocalStorage = () => {
    return localStorage.getItem('law')
  }

  /** Browser zoom level, used for Safari compatibility */
  browserZoomLevel = 0.8
  
  /**
   * Detects if the current browser is Safari on desktop
   * @returns {boolean} True if browser is Safari on desktop
   */
  isSafariDesktop() {
    return (navigator.userAgent.indexOf('Version') > -1) && !this.isMobile
  }
  
  /**
   * Returns the current browser zoom level
   * Used only for Safari Desktop to address font scaling issues
   * @returns {number} Current browser zoom level
   */
  labelZoom = () => {
    return this.browserZoomLevel
  }
  
  /**
   * Handles label zoom adjustments for Safari Desktop
   * Addresses font scaling issues when components are deeply nested
   * and the user scales down the page to minimum
   */
  handleLabelZoom() {}
  
  /** Volume meter array for audio visualization */
  #vmeter = []

  /**
   * Loads the state of the drum machine
   * Either restores from localStorage or performs a clean load
   * @returns {Promise<void>}
   */
  async loadState() {
    if (localStorage.length) {
      let localSession = localStorage.getItem('session')
      this.lastActiveWheel = localStorage.getItem('law')

      const loadLocal = async () => {
        if (!this.StateSetters[localStorage.getItem('law')]) {
          localStorage.setItem('law', 'AClaw') 
        }

        // The Safari bug is here - cannot load fast enough and gives bank error
        // Also, we need factory to go on the background, and land on the last stayed preset

        await this.consumeEditKey('LOAD', new Blob([localSession]), false, "", localStorage.getItem('currentLocation'))
  
        this.StateSetters[localStorage.getItem('law')](true)
        this.lastActiveWheel = localStorage.getItem('law')

        this.setEditKeysStatus()
        this.handleLabelZoom()

        let bank = localStorage.getItem('currentBank')
        let preset = localStorage.getItem('currentPreset')

        this.currentBank = bank?bank:this.currentBank
        this.currentPreset = preset?preset:this.currentPreset
        this.oldBank = this.currentBank

        const storedBankName = localStorage.getItem('currentBankUserName')
        this.StateSetters['sbBank'](storedBankName)
        if (this.currentBank[0]!=='F') {
          this.banks[Number(this.currentBank.slice(3)) + 2] = storedBankName.slice()
        }
        
      }; await loadLocal()
    } else {
      this.handleLabelZoom()
      this.#setMemory(this.PRESETS[0], false, true)
    }
  }

  /**
   * Loads factory bank presets from files
   * @returns {Promise<void>}
   * @private
   */
  async #loadFactoryBanks() {
    const storedLocation = localStorage.length?localStorage.getItem('currentLocation'):""

    const fb1 = await (await fetch('./FB 1.tr909bank')).blob()
    const fb2 = await (await fetch('./FB 2.tr909bank')).blob()
    this.#selectedBank = 'FBa0'
    try {
      await this.consumeEditKey('LOAD', fb1, false, "FB 1.tr909bank", storedLocation)
    } catch (error) {
      // Wraping the eeror is neccessary for develping locally.
      // The error is an artifact and never occurs in buit application.
    }
    this.#selectedBank = 'FBa1'
    try {
      await this.consumeEditKey('LOAD', fb2, false, "FB 2.tr909bank", storedLocation)
    } catch (error) {
      // Wraping the eeror is neccessary for develping locally.
      // The error is an artifact and never occurs in buit application.
    }
    this.#selectedBank = ""
  }

  /**
   * Whether the help menu is currently visible
   * @type {boolean}
   */
  HELP = false
  
  /**
   * Engine constructor
   * Initializes the drum machine engine and loads necessary resources
   * @param {string} debug - Debug level/mode
   */
  constructor(debug) {
    // Initialize preset slots
    for (let i=0; i<128; i++) { this.PRESETS[i] = this.#generateEmptyPreset() }

    // First load the stored color scheme if available
    if (localStorage.length) {
      let storedColor = localStorage.getItem('currentBodyColor')
      let storedRangeValue = localStorage.getItem('hueRangeVar')
      if (storedColor&&storedRangeValue) {
        document.body.style.backgroundColor = storedColor
        this.hueRangeVar = storedRangeValue
        this.currentBodyColor = storedColor
      }
      let storedFontColor = localStorage.getItem('currentFontColor')
      if (storedFontColor) { this.currentFontColor = storedFontColor }
    }
    
    // Detect if running on mobile device
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    this.isReloaded = true
    this.#debug = debug
    this.#memory = this.#generateMemory()
    this.#createTables()
    this.#createDisplaySetters()
    this.#createPlaybackTable()
    this.#createSoundTable()
    this.linearGradient = this.#generateHueBar() 

    this.#boost = this.#audioCtx.createWaveShaper()
    this.#setBoost()
    this.#setGAS()
    
    setTimeout(() => {
      // Small delay necessary for older browsers
      this.#loadFactoryBanks()
    }, 125)
  }
}

/**
 * Factory function to create and initialize the Engine
 * @param {string} debug - Debug level/mode
 * @returns {Engine} New Engine instance
 */
export default function initiateEngine(debug='') {
  return new Engine(debug)
}
