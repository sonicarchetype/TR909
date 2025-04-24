import { React, useEffect, useState, useRef, useCallback, useMemo} from 'react';

import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useNavigate
} from "react-router-dom";

import './App.css';
import githubLogo from './assets/github-mark-white.svg';
import helpData from '../src/helpData.json';
import SEO from './components/SEO';

/**
 * Version checking service for the TR909 application
 * @namespace
 * @property {boolean} updateAvailable - Indicates if an update is available
 * @property {string|null} currentVersion - The current version of the application
 * @property {string|null} latestVersion - The latest available version
 * @property {boolean} isDevelopment - Flag indicating if running in development mode
 */
const versionService = {
  updateAvailable: false,
  currentVersion: null,
  latestVersion: null,
  isDevelopment: false, // Development mode flag
  
  /**
   * Initializes the service and detects development environment
   * @returns {Object} The initialized versionService object
   */
  init: function() {
    // Check if running on local development server
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    // Development environments typically use localhost or local IP with dev ports
    if (hostname === 'localhost' || 
        hostname.startsWith('192.168.') || 
        hostname.startsWith('127.0.0.') ||
        port === '16' || 
        port === '5173' || // Vite default
        port === '3000') { // Other common dev ports
      this.isDevelopment = true;
      console.log('TR909: Running in development mode - version checking disabled');
    }
    
    return this;
  },
  
  /**
   * Checks for updates by comparing current version with latest version from GitHub
   * @async
   * @param {Function} [callback] - Optional callback function to be called with update status
   */
  checkForUpdates: async function(callback) {
    try {
      // Get current version
      const packageResponse = await fetch('/package.json');
      const packageData = await packageResponse.json();
      this.currentVersion = packageData.version;
      
      // In development mode, just use the local version and skip GitHub check
      if (this.isDevelopment) {
        helpData['sbVersion'] = `Development Version ${this.currentVersion}`;
        if (callback) callback(false);
        return;
      }
      
      // Get latest version from GitHub
      const githubResponse = await fetch('https://api.github.com/repos/sonicarchetype/TR909/commits/main');
      if (githubResponse.ok) {
        const githubData = await githubResponse.json();
        const commitMessage = githubData.commit.message;
        const versionMatch = commitMessage.match(/Update version to ([\d.]+)/);
        
        if (versionMatch && versionMatch[1]) {
          this.latestVersion = versionMatch[1];
          
          if (this.latestVersion !== this.currentVersion) {
            this.updateAvailable = true;
            
            // Update help text
            helpData['sbVersion'] = `Current Version ${this.currentVersion}. Update available to ${this.latestVersion}. Save your progress and update at any time.`;
          } else {
            this.updateAvailable = false;
            helpData['sbVersion'] = `Current Version ${this.currentVersion}.`;
          }
          
          // Notify listeners
          if (callback) callback(this.updateAvailable);
        }
      }
    } catch (error) {
      console.error('Error checking version:', error);
    }
  }
}.init(); // Initialize immediately

/**
 * Runs the unit in the debug mode where nearly all component blocks are differed by color.
 * Some output to the console can be defined as `debug&&Log(...)`
 */
export const debug = !true

/**
 * TR909 engine with debug mode configuration
 * @param {boolean} debug - Debug mode flag that enables additional logging and visual debugging
 * @returns {Object} The initialized TR909 engine instance
 */
let engine = initiateEngine(debug)

const Log = console.log

/**
 * Pad component - Creates a simple div element with configurable dimensions and styling
 * 
 * This component is used throughout the application to create spacing and visual structure.
 * In debug mode, it will display with the specified background color and opacity.
 * 
 * @param {Object} props - Component properties
 * @param {Array} props.params - Array containing [width, height, backgroundColor, opacity]
 * @returns {JSX.Element} A div element with the specified dimensions and styling
 */
function Pad({params}) {
  return <div style={{
    width: params[0],
    height: params[1],
    backgroundColor: debug&&params[2],
    opacity: debug&&params[3],
  }}></div>
}

/**
 * style utility function - Creates a style object with standard properties
 * 
 * This function is used to maintain consistent styling across components.
 * It takes basic dimension parameters and combines them with additional style properties.
 * In debug mode, it will apply the specified background color and opacity.
 * 
 * @param {Array} params - Array containing [width, height, backgroundColor, opacity]
 * @param {Object} rest - Additional style properties to merge with the base styles
 * @returns {Object} A complete style object for React components
 */
function style(params, rest) {
  return {
    width: params[0], height: params[1],
    backgroundColor: debug&&params[2],
    opacity: debug&&params[3],
    ...rest
  }
}

/** Global styling shadow */
const boxShadow = "0px 22px 18px rgb(0, 0, 0, 0.072), 0px 42px 33px rgb(0, 0, 0, 0.186)"

/**
 * MainKey component represents the main interactive keys in the drum machine interface.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.elementId - Unique identifier for the key
 * @param {string} props.INST - Instrument label associated with this key
 * @returns {JSX.Element} - A button element with appropriate styling and behavior
 */
function MainKey({elementId, INST}){
  /**
   * Every MainKey has 3 states:
   * - off(0): Key is inactive
   * - normal(1): Key is active with normal velocity
   * - accent(2): Key is active with accent (higher velocity)
   * 
   * The state can be changed through multiple pathways:
   * 1. Locally after a user click
   * 2. When SELECTOR_CODE changes (via LedKey)
   * 3. When SELECTED_INST changes (via engine.consumeMK, MainKey's CE-TA case, or ShiftKey)
   * 4. When a pattern changes (via engine.consumeMK in 'STOP' mode)
   * 5. After a CLEAR operation (via engine.clearPattern)
   * 6. After STEP-TAP mode changes (TAP mode shows a diagonal slice of the pattern)
   */
  const [state, setState] = useState(
    // Sets default state for special keys like START and STOP
    () => {switch (elementId) {
      case 'START': return 's'
      case 'STOP': return 'p'
      default: return 0
    }}
  )
  const [_, makeReload] = useState(0)
  const [isOFF, setIsOff] = useState(false)
  const [selectPattern, setSelectPattern] = useState(false)
  const [copyMark, setCopyMark] = useState(false)

  // Register state setters in engine.StateSetters and clean up on unmount
  useEffect(() => {
    engine.StateSetters[elementId] = setState
    if (elementId==='CE-TA') engine.StateSetters[elementId+'r'] = makeReload
    if (!isNaN(elementId)) engine.StateSetters[elementId+43] = setIsOff
    engine.StateSetters[elementId+'ssp'] = setSelectPattern
    engine.StateSetters[elementId+'cm'] = setCopyMark
    return () => {
      delete engine.StateSetters[elementId]
      if (elementId==='CE-TA') delete engine.StateSetters[elementId+'r']
      if (!isNaN(elementId)) delete engine.StateSetters[elementId+43]
      delete engine.StateSetters[elementId+'ssp']
      delete engine.StateSetters[elementId+'cm']
    }
  }, [elementId])

  /**
   * Gets the updated state for a key based on current context
   * @param {string} elementId - Key identifier
   * @param {string} INST - Current instrument
   * @returns {number} - The new state value
   */
  const increaseState = (elementId, INST) => {
    let fetchedState = engine.getUpdatedMemorySlot(
      elementId, engine.SELECTED_INST, INST)
    return fetchedState 
  }

  /**
   * Visual indicator component for the key's state
   * @param {Object} props - Component properties
   * @param {string} props.clipPath - CSS clip-path for shaping
   * @param {string} props.width - Width of the indicator
   * @param {string} props.height - Height of the indicator
   * @param {string} props.background - Background style
   * @param {string} props.transform - CSS transform
   * @returns {JSX.Element} - Styled div element
   */
  const Type = ({clipPath='', width='22px', height='9px',
    background='radial-gradient(rgba(77, 77, 77, 0.918) 92%, #9198e50f)',
    transform= ''
  }) => {
    return <div
    style={{
      display: 'inline-block',
      width: width, height: height, marginBottom: '11.5px',
      justifySelf: 'center', alignSelf: 'center',
      background: background, transform: transform,
      clipPath: clipPath
    }}
    ></div>
  }
  let type
  /**
   * Determines the CSS class and visual indicator based on key state
   * @returns {string} - CSS class string
   */
  const giveClass = () => {
    switch (state) {
      case 's': { type = <Type clipPath='polygon(10% 0%, 100% 50%, 10% 100%)' width='20px' height='20px'/>; break }
      case 'p': { type = <div>
        <Type width='7px' height='20px'/>
        <Type width='6px' height='20px' background='transparent'/>
        <Type width='7px' height='20px'/>
      </div>; break }
      case 'S': { type = <Type width='20px' height='20px'/>; break }
      default: {
        type = <Type background={!state?
          `rgba(77, 77, 77, 0.918)`
          :`rgba(${r}, ${g}, ${b}, ${mainKeyStateLightFoo(state)})`}
          />
        let patternClass = selectPattern?"mk-sel-pattern":""
        return patternClass + " transparent " // ends with <blank> !!!
      }
    }
  }
  /**
   * Determines additional base classes for the key
   * @returns {string} - CSS class string for base styling
   */
  const giveClassWithBase = () => {
    if (elementId === 'CE-TA'&&!engine.TRACK_WRITE)
      return 'fade-out-mk pe-none'
    return isOFF?"fade-out-mk":""
  }
  /**
   * Handles click events on the key
   * @param {string} elementId - Key identifier
   * @param {string} INST - Instrument label
   * @param {Event} event - Browser event object
   */
  const handleClick = (elementId, INST, event) => {
    switch (elementId) {
      case 'START':
        engine.setDisplay(elementId, elementId)
        engine.StateSetters['STOP']('S')
        break
      case 'STOP':
        if (engine.GLOBAL_SSC === 'STOP') {
          engine.setDisplay(elementId, 'CONT')
          engine.StateSetters['STOP']('S')
        } else {
          engine.setDisplay(elementId, elementId)
          engine.StateSetters['STOP']('p')
        }
        break
      case 'CE-TA':
        // CE-TA is handled by this function for simplicity
        engine.consumeLedKey(elementId)
        break
      default:
        let newState = 0
        /* Special case: when FIRST or LAST step is active (fading out unplayed keys),
           but we're in TAP mode expecting to input notes */
        if (engine.TRACK_WRITE&&isOFF&&engine.GLOBAL_MODE==='TAP') {
          newState = increaseState(elementId, INST)
          engine.StateSetters[elementId](newState)
        }
        else if (engine.TRACK_WRITE&&!isOFF) {
          newState = increaseState(elementId, INST)
          // Using StateSetters instead of direct setState to handle keyboard focus issues
          engine.StateSetters[elementId](newState)
        } else {
          newState = state
        }
        engine.consumeMk(elementId, INST, newState, event.altKey)
    }
  }
  engine.StateSetters['handleClickMk'] = handleClick
  // Set color variables - highlight open hi-hat (HHO) with different color
  let r, g, b
  if (state >= 3) {
    r = 30; g = 236; b = 254 // HHO color (cyan)
  } else {
    r = 255; g = b = 64; // default color (yellow)
  }
  // Determine tooltip id based on elementId
  const tooltipId = !isNaN(elementId)?'mk':elementId
  // Create the main button element
  const buttonContent = (
    <button
      id={elementId}
      className={giveClass() + 'f-col-cen mk box_ ' + giveClassWithBase()}
      onClick={event => {engine.isMouseDown&&!engine.isOngoingAlert&&
        handleClick(elementId, INST, event)}}
      onMouseDown={event => {!engine.isMobile&&!engine.isOngoingAlert&&
        handleClick(elementId, INST, event)}}
      onTouchStart={event => {engine.isMobile&&!engine.isOngoingAlert&&
        handleClick(elementId, INST, event)}}
      style={style(['66px','66px'], { 
        boxShadow: boxShadow, borderTopLeftRadius: '2px',
        borderTopRightRadius: '2px',
        borderTop: copyMark?'0.4rem solid':'none',
        borderImageSource: 'radial-gradient(rgb(255, 255, 255, 0.62) 62%, #9198e50f)',
        borderImageSlice: 1,
        boxSizing: 'border-box',
        paddingTop: 1,
        })}>
      
        <Pad params={['', '12px']}/>
        <div style={{marginTop: copyMark ? '-0.38rem' : 0}}>
        {type}
        </div>
    </button>
  );
  return <Tooltip id={tooltipId} payload={buttonContent}></Tooltip>
}

/**
 * Regulates the MainKey(s)' led light intensity.
 * Modeled as Cubic Regression.
 * 
 * Addresses the issue with 'HHC' and 'HHO' that sit on the same track, yet
 * have different state values.
 * @param {*} state MainKey state value.
 */
const mainKeyStateLightFoo = (state) => {
  const lightIntensity = 
  -0.12 + 1.386667*state - 0.52*state**2 + 0.05333333*state**3
  return state===1||state===3?lightIntensity*0.9:lightIntensity
  // *0.9 reduces a bit more the regular, non-accented note's light as was intended and modeled
}

/**
 * ShiftKey component represents the SHIFT button in the drum machine interface.
 * 
 * The SHIFT key is a critical control element that:
 * - Toggles TRACK_WRITE mode which determines if pattern changes are recorded
 * - Serves as a modifier for other controls, changing their behavior when active
 * - Manages instrument selection state and memory between different modes
 * - Updates the display to show current operational status
 * - Coordinates with other components through the engine's state management system
 * 
 * When SHIFT is active, the interface enters a special state where certain operations
 * are locked or modified, similar to a hardware drum machine's shift functionality.
 * 
 * @returns {JSX.Element} - A styled button that visually indicates SHIFT state
 */
function ShiftKey () {
  const [isClicked, setIsClicked] = useState(true)
  // const dispatch = useDispatch()
  engine.StateSetters['SHIFT'] = setIsClicked

  /**
   * Handles click events on the SHIFT key with multiple effects:
   * 
   * 1. Toggles the visual state of the SHIFT button
   * 2. Ensures clean state transitions via engine helper methods
   * 3. Controls TRACK_WRITE mode which affects pattern recording
   * 4. Updates display information based on current mode
   * 5. Manages instrument selection memory between modes
   * 6. Broadcasts state changes to other components
   * 7. Updates pattern and step information in the engine
   * 
   * This complex interaction mimics the behavior of hardware drum machines
   * where SHIFT acts as both a mode selector and a modifier key.
   */
  const handleClick = () => {
    setIsClicked(!isClicked)

    engine.ensureSHIFTFallsBackClean()

    // SHIFT locks and unlocks TRACK_WRITE!
    engine.TRACK_WRITE = isClicked

    // The key 'GLCV' sets the display and the GLCV variable
    if (isClicked) {
      if (engine.GLOBAL_MODE==='TAP') {
        engine.setSelInst('ALL') 
      } 
      
      engine.setDisplay('GLCV', 'SHIFT')
      engine.setStepTap(engine.GLOBAL_MODE)

    } else {
      engine.setDisplay('GLCV', undefined)
      engine.setStepTap('')
    }    

    // Broadcast the message to all other LedKey(s)
    // Could have been done without Redux but with StateSetters.
    // dispatch(setSHIFT(isClicked))
    engine.broadcastSHIFTChange()

    // This manages switching from AC memory track back to were it was before
    // if SHIFT was turned off and TOTAL ACCENT has recorded a previous INST.
    if (isClicked) {
      engine.lastSELECTED_INST = engine.SELECTED_INST
      engine.highlightSelectedInstrument(engine.lastSELECTED_INST)
    } else {
      engine.SELECTED_INST = engine.lastSELECTED_INST
      engine.setSelInst(engine.SELECTED_INST)
      engine.highlightSelectedInstrument()
      engine.setMksState()
      engine.StateSetters['CE-TA'](false) 
    }

    engine.updatePatternAndInstSTEP()
    engine.setEditKeysStatus()
  }
  engine.StateSetters['handleClickSHIFT'] = handleClick
  const shiftKey = (
    <button
    className={!isClicked ? 'orange-light orange-shadow' : 'orange-shadow'}
    onClick={() => !engine.isOngoingAlert&&handleClick()}
    style={style(['30px','30px',])}>
    </button>
  )
  return <Tooltip id='SHIFT' payload={shiftKey}></Tooltip>
}

/**
 * A button component that represents a LED key in the interface.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.elementId - Unique identifier for the key
 * @returns {JSX.Element} - A button element styled as a LED key
 */
function LedKey({elementId}) {
  const [isClicked, setIsClicked] = useState(false)
  const [_, makeReload] = useState(0)

  // Register state setters in engine.StateSetters and clean up on unmount
  useEffect(() => {
    engine.StateSetters[elementId] = setIsClicked
    engine.StateSetters[elementId+'-reload'] = makeReload
    return () => {
      delete engine.StateSetters[elementId]
      delete engine.StateSetters[elementId+'-reload']
    }
  }, [elementId])

  // Track write mode from engine
  const isSHIFT = engine.TRACK_WRITE

  /**
   * Handles click events on the LED key
   * @param {string} elementId - The ID of the clicked element
   */
  const handleClick = (elementId) => {
    !engine.isOngoingAlert&&engine.consumeLedKey(elementId)
  }
  engine.StateSetters['handleClickLk'] = handleClick

  /**
   * Determines the orange light styling based on elementId and state
   * @returns {string} CSS class names for orange light styling
   */
  const giveOrangeLight = () => {
    switch (elementId) {
      case 'SCALE':
        if (engine.isBankTable || engine.isQueueTable) {
          return 'fade-out pe-none'
        }
      case 'TS-PM':
        return isClicked?'orange-light orange-shadow':""
      case 'ALT':
        return isClicked?'alt-key':''
      case 'EXT':
        return 'fade-out pe-none'
      case 'CG':
        return engine.isGuide()?'orange-light':''
      case 'CLEAR':
        return isClicked? 'orange-light orange-shadow' : 'orange-light-active orange-shadow'
      case 'TEMPO-'+engine.GLOBAL_MODE:
      case 'BACK-'+engine.GLOBAL_MODE:  
        return 'orange-light orange-shadow'
      case 'INST SELECT':
      case 'LAST STEP':
      case 'SHUFF /FLAM':
        return isClicked? 'orange-light orange-shadow' : 'orange-light-active orange-shadow'
      case 'Q':
        if (engine.GLOBAL_MODE === 'STEP') 
          return 'fade-out pe-none'
        return isClicked?'quantize-key':''
      case engine.SELECTOR_CODE[0]: // BANK
      case engine.SELECTOR_CODE[1]: // TRACK
      case engine.SELECTOR_CODE[2]: // PatternGroup
        return 'orange-light'
      default:
        return 'orange-light-active orange-shadow'
    }
  }

  /**
   * Determines the red light styling based on elementId and state
   * @returns {string} CSS class names for red light styling
   */
  const giveRedLight = () => {
    switch (elementId) {
      case 'TS-PM':
        return isClicked?'red-light red-shadow':""
      case 'ALT':
        return isClicked?'alt-key':''
      case 'EXT':
        return 'fade-out pe-none'
      case 'INST SELECT':
      case 'CG':
      case 'TEMPO-STEP':
        return isClicked? 'red-light red-shadow' : 'red-light-active red-shadow'
      case 'LAST STEP':
        if (engine.getPlaybackQueueLength()<2 || !engine.isQueueTable){
          return 'fade-out pe-none'
        } else {
          return isClicked?'red-light red-shadow':'red-light-active red-shadow' 
        }
      case 'CLEAR':
      case 'SCALE':
      case 'SHUFF /FLAM':
      case 'Q':
        return 'fade-out pe-none'
      case engine.SELECTOR_CODE[1]: // TRACK
      case engine.SELECTOR_CODE[2]: // PatternGroup
        return 'red-light'
      default:
        return 'red-light-active red-shadow'
    }
  }

  /**
   * Handles mouse/touch down events, particularly for keys that have hold functionality
   */
  const handleDown = () => {
    elementId==='CLEAR'&&engine.holdThenExecute('CPD', '', 1500)
    elementId==='TS-PM'&&engine.holdThenExecute('CPM', '', 1500)
  }

  /**
   * Handles mouse/touch up events, stopping hold tracking
   */
  const handleUp = () => {
    elementId==='CLEAR'&&engine.stopTrackingHeldKey()
    elementId==='TS-PM'&&engine.stopTrackingHeldKey()
  }

  /**
   * Returns the label text for specific keys
   * @returns {string|undefined} The label text or undefined
   */
  const label = () => {
    switch (elementId) {
      case 'TS-PM': return 'R'
      case 'Q':
        return '|||'
      case 'ALT':
        return 'ALT'
      default: break
    }
  }
  const ledKey =  (
    <button
    id={elementId}
    className={
      (isSHIFT ? giveOrangeLight() : giveRedLight()) + ' transform ' + 'butt-scaleUp-lil ' + 'box_'}

    onMouseDown={() => !engine.isOngoingAlert&&handleDown()}
    onMouseUp={() => !engine.isOngoingAlert&&handleUp()}
    onTouchStart={() => !engine.isOngoingAlert&&handleDown()}
    onTouchEnd={() => !engine.isOngoingAlert&&handleUp()}

    onClick={() => {handleClick(elementId)}}
    style={style(['30px','30px',], {
      fontSize: '90%', boxShadow: boxShadow
    })}><div className={'labeled-key' + (elementId==='ALT'?' scale-90percent':'')}>
      <span style={{transform: `scale(${engine.labelZoom()})`}}>{label()}</span>
      
    </div>
    </button>
  )
  return <Tooltip id={elementId} payload={ledKey}></Tooltip>
}

/**
 * MainKeysStrip component displays the main keys strip in the interface.
 * @returns Styled layout block hosting MainKey(s).
 */
function MainKeysStrip() {
  return (
    <div
      className='f-row'
      style={style(['100%','66px'], {
        position: 'relative'
      })}>
        <Pad params={['15px','100%','coral']} />

        <div 
          className='f-row'
          style={style(['100%', '12px', 'grey', 0.5], {
            position: 'absolute',
            top: 12,
            zIndex: -2
          })}>
            {/* <Pad params={['9px','100%','black',]} /> */}
            <BeatRunner />
          </div>

        {/* <Pad params={['7px', '100%', 'green']}/> */}
        <MainKey elementId={0} INST='BD'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={1} INST='BD'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={2} INST='SD'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={3} INST='SD'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={4} INST='LT'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={5} INST='LT'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={6} INST='MT'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={7} INST='MT'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={8} INST='HT'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={9} INST='HT'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={10} INST='RS'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={11} INST='HC'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={12} INST='HHC'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={13} INST='HHO'/>
        <Pad params={['13px', '100%', 'coral']}/>
        <MainKey elementId={14} INST='CR'/>
        <Pad params={['13px', '100%', 'violet']}/>
        <MainKey elementId={15} INST='RD'/>
        <Pad params={['13px', '100%', 'coral']}/>
    </div>
  )
}

/**
 * DStepTap component displays the current step or tap mode information.
 * 
 * This component shows the current operational mode (STEP or TAP) in the LED display.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {JSX.Element} A div containing the step/tap mode text
 */
function DStepTap() {
  const [stepTap, setStepTap] = useState('')
  engine.setStepTap = setStepTap
  return <div style={{margin: 0}}><b>{stepTap}</b></div>
}

/**
 * DInfinity component displays the infinity symbol when cycle mode is active.
 * 
 * This component renders the infinity symbol (∞) when the drum machine is in cycle mode,
 * indicating that patterns will loop continuously.
 * 
 * @returns {JSX.Element} The infinity symbol or an empty fragment
 */
function DInfinity() {
  const [infinity, setInfinity] = useState(0)
  engine.StateSetters['setDInfinitySign'] = setInfinity

  return infinity ? ' ∞ ' : <></>
}

/**
 * DTempo component displays the current tempo value.
 * 
 * This component shows the current tempo setting in the LED display.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {JSX.Element} A styled div containing the tempo value
 */
function DTempo() {
  const [tempo, setTempo] = useState()
  engine.setTempo = setTempo

  return <div className='monospace' style={{
    fontSize: '200%', 
    // marginLeft: 4,
    // marginTop: 5
  }}><i style={{marginRight: 10}}>{tempo}</i>
  </div>
}

/**
 * DControlVariable component displays the current control mode.
 * 
 * This component shows the active control mode in the LED display.
 * It handles different display states based on the current mode (PLAY, WRITE, etc.)
 * and modifiers like ALT key.
 * 
 * @returns {string} The current control mode text to display
 */
function DControlVariable() {
  const [lcv, setLCV] = useState('')
  const [_, reload] = useState(0)
  engine.setLCV = setLCV
  engine.StateSetters['DControlVariable-r'] = reload
  engine.StateSetters['DCV_lcv'] = lcv

  // Always prioritize specific LCV values when present
  if (lcv) {
    const lcvPrefix = lcv.slice(0, 3)
    if (lcvPrefix === 'INS' || lcvPrefix === 'DIS') {
      return lcv
    }
  }
  
  // Handle PLAY mode
  if (!engine.TRACK_WRITE) {
    // If lcv is specifically set to INST SELECT, return it 
    if (lcv === 'INST SELECT') {
      return lcv
    }
    
    // Otherwise, show appropriate play mode based on current view
    if (engine.isBankTable) {
      return 'PLAY PRESET'
    } 
    if (engine.isQueueTable) {
      return 'ADD PATTERN TO QUEUE'
    }
    return 'PLAY BEAT'
  }
  
  // Handle WRITE mode
  const globalLedValue = engine.GLOBAL_LED_CONTROL_VARIABLE()
  
  // Special case for LAST STEP with ALT key
  if (globalLedValue === 'LAST STEP' && engine.isAltKey() && lcv === 'LAST STEP') {
    return 'WRITE FIRST STEP'
  }
  
  // Handle empty or SHIFT global LED values
  if (!globalLedValue || globalLedValue === 'SHIFT') {
    return 'WRITE BEAT'
  }
  
  // For standard control variables, return "WRITE X"
  if (['SCALE', 'TOTAL ACCENT', 'LAST STEP', 'FIRST STEP', 'SHUFF /FLAM'].includes(globalLedValue)) {
    return `WRITE ${lcv || globalLedValue}`
  }
  
  // Default fallback: return the lcv value directly
  return lcv
}

/**
 * DScale component displays the current scale setting.
 * 
 * This component shows the active scale value in the LED display.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {string} The current scale value prefixed with 's'
 */
function DScale() {
  const [scale, setSCALE] = useState([true, ''])
  engine.setSCALE = setSCALE
  // useEffect(() => {
  // }, [scale])
  return 's' + scale[1]
}

/**
 * DSelectedInst component displays the currently selected instrument.
 * 
 * This component shows which drum instrument is currently selected (BD, SD, etc.).
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {JSX.Element} A div containing the selected instrument code
 */
function DSelectedInst() {
  const [selInst, setSelInst] = useState('BD')
  engine.setSelInst = setSelInst
  return <div>({selInst})</div>
}

/**
 * DSelectedPattern component displays the currently selected pattern number.
 * 
 * This component shows which pattern is currently selected in the sequencer.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {number} The current pattern number
 */
function DSelectedPattern() {
  const [selPat, setSelPat] = useState(1)
  engine.setSelPat = setSelPat
  return selPat
}

/**
 * DPlaybackQueue component displays the current queue length.
 * 
 * This component shows how many patterns are currently in the playback queue.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {number} The current queue length
 */
function DPlaybackQueue() {
  const [queueLen, setQueueLen] = useState(1)
  engine.StateSetters['setQueueLen'] = setQueueLen
  return queueLen
}

/**
 * DLastPatAddToQueue component displays the last pattern added to the queue.
 * 
 * This component shows the pattern number that was most recently added to the queue.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {number} The last pattern number added to the queue
 */
function DLastPatAddToQueue() {
  const [lastPat, setLastPat] = useState(1)
  engine.StateSetters['setLastPat'] = setLastPat
  return lastPat
}

/**
 * DSelectedQTSlot component displays the currently selected queue table slot.
 * 
 * This component shows which slot in the queue table is currently selected.
 * It exposes a setter function to the engine for external control.
 * 
 * @returns {number} The current queue table slot number
 */
function DSelectedQTSlot() {
  const [selectedQTSlot, setSelectedQTSlot] = useState(1)
  engine.StateSetters['setSelectedQTSlot'] = setSelectedQTSlot
  return selectedQTSlot
}

/**
 * @returns Vermilion color Display component hosting the unit's state info.
 */
/**
 * LedDisplay component renders the main display area of the drum machine interface.
 * It shows step information, pattern selection, and tempo in a stylized LED-like display.
 * 
 * The display is divided into two main sections:
 * - Left section (38%): Shows step/tap information and selected pattern
 * - Right section (62%): Displays the current tempo
 * 
 * The component uses a red gradient background to simulate the look of vintage
 * LED displays found in classic drum machines.
 * 
 * @returns {JSX.Element} A component that displays current sequencer state information
 * in a red LED-style display panel.
 */
function LedDisplay() {
  return (
    <div
    className='f-row monospace'
    style={{
      width: '100%',
      height: '68px',
      display: 'flex',
      color: 'white', 
      fontSize: "200%",
      boxShadow: boxShadow,
      background: 'radial-gradient(rgb(228, 34, 0) 7%, #9198e50f)'
    }}>
      {/* Left section - Step/Tap info and Pattern selection */}
      <div
      className='f-col'
      style={style(['38%', '100%', 'grey'])}>
        {/* Step/Tap display area */}
        <div
        className='text-center-only'
        style={style(['100%', '38%', 'green'], {
          justifyContent: 'start', 
          marginLeft: 6, 
          marginTop: 0,
          background: 'radial-gradient(rgb(239, 236, 236) 7%, #9198e50f)',
          backgroundClip: 'text', 
          fontSize: '70%'
        })}>
          <Tooltip id={'DStepTap'} payload={<DStepTap/>}></Tooltip>
        </div>

        {/* Pattern selection display area */}
        <Tooltip id={'DSelectedPattern'} payload={<div
        className='text-center-only' 
        style={style(['100%', '62%', 'darkgrey'], {
          marginTop: '10px'
        })}>
          <DSelectedPattern/>
        </div>}></Tooltip>
      </div>

      {/* Right section - Tempo display */}
      <div
      className='text-center-only' 
      style={style(['62%', '100%', 'blue'], {
        justifyContent: 'end', 
        // marginRight: 8
      })}>
        <Tooltip id={'DTempo'} payload={<DTempo/>}></Tooltip>
      </div>
      
    </div>
  )
}

import RedDotLight from './assets/TR-909-red-dot-light.svg';
/**
 * 
 * @returns SCALE indication component.
 */
/**
 * ScaleLight component represents the visual indicator for the SCALE function.
 * 
 * This component displays a red dot light that moves vertically to indicate
 * the current scale setting. The position of the light corresponds to different
 * scale values used in the drum machine's sequencer.
 * 
 * The component:
 * - Maintains state for the vertical position of the light
 * - Exposes a setter function to the engine for external control
 * - Renders a non-draggable SVG image with appropriate styling
 * 
 * @returns {JSX.Element} A styled div containing the scale indicator light
 */
function ScaleLight () {
  // State to track the vertical position of the scale light
  const [scaleLightY, setSCALELightY] = useState(101)
  
  // Expose the setter to the engine for external control
  engine.setSCALELightY = setSCALELightY
  
  const scaleLight = (
    <div 
    className='f-col-cen'
    // Position values: s4 -23 , s3 -49 , s2 -75 , s1 -101 
    style={style(['26px', scaleLightY, 'white'], {
      justifyContent: 'end',
    })}
    >
      <img 
      style={{backgroundImage: 'radial-gradient(#ff4040 5%, #9198e50f)'}}
      draggable='false'
      width={'16.4px'}
      height={'23px'}
      src={RedDotLight} alt="Scale indicator light" 
      />
    </div>
  )
  return <Tooltip id={'scaleLight'} payload={scaleLight}></Tooltip>
}

/**
 * Sequencer component represents the main sequencing interface of the drum machine.
 * 
 * This component organizes the layout of the sequencer section, including:
 * - Control buttons panel on the left side
 * - Scale indicator light
 * - Pattern number labels
 * - Main sequencer keys for programming drum patterns
 * - Edit command buttons
 * - Instrument label strip
 * 
 * The layout uses a combination of flex containers to organize elements both
 * horizontally and vertically, with appropriate spacing provided by Pad components.
 * 
 * @returns {JSX.Element} The complete sequencer interface
 */
function Sequencer() {
  /**
   * TooltipBlock component - Renders a block of tooltips for scale indicators.
   * @returns {JSX.Element} A column of Tooltip components for scale indicators
   */
  const TooltipBlock = () => {
    // Create a scale tooltip with full width and height
    const tooltipScale = <div 
      style={{width: '100%', height: '100%'}}></div>
    
    // Array to hold Tooltip components
    const kids = []
    
    // Generate Tooltip components for scale levels 4 to 1
    for (let i = 4; i >= 1; i--) { 
      kids.push(
        <Tooltip 
          key={i} 
          id={'SCALE' + i} 
          payload={tooltipScale} 
          width='100%' 
          height='25%'
        />
      )
    }
    
    // Return a column layout containing all Tooltip components
    return (
      <div className='f-col' style={{width: '98%', height: '100%'}}>
        {kids}
      </div>
    )
  }

  return(
    <div 
    id='sequencer'
    style={style(['', '', '', '0.5'])}
    className='sequencer'>

      {/* Left panel containing LED control buttons */}
      <div
      className='f-row'
      style={style(['117px', '100%'])}>
        <Pad params={['21px', '100%', 'violet', '0.9']}/>
        
        {/* First column of control buttons */}
        <div
        className='f-col'
        style={style(['30px', '100%', 'yellow', '0.8'])}>
          <Pad params={['100%', '24px', 'green', '']}/> 
          <LedKey elementId={'LAST STEP'} />
          <Pad params={['100%', '32px', 'green']}/>
          <LedKey elementId={'SHUFF /FLAM'}/>
          <Pad params={['100%', '32px', 'green']}/>
          <LedKey elementId={'INST SELECT'} />
          <Pad params={['100%', '32px', 'green']}/>
          <LedKey elementId={'Q'}/>
        </div>
        <Pad params={['22px', '100%', 'violet', '0.1']}/>

        {/* Second column of control buttons */}
        <div
        className='f-col'
        style={style(['30px', '100%', 'yellow', '0.8'])}>
          <Pad params={['100%', '24px', 'green']}/> 
          <LedKey elementId={'SCALE'}/>
          <Pad params={['100%', '32px', 'green']}/>
          <LedKey elementId={'CLEAR'}/>
          <Pad params={['100%', '32px', 'green']}/>
          <ShiftKey />
          <Pad params={['100%', '32px', 'green']}/>
          <LedKey elementId={'ALT'} />
        </div>
      </div>

      {/* Main sequencer interface area */}
      <div className='f-col'
        style={style(['1283px','100%'])}>
          <div 
          className='f-row'
          style={style(['100%', '101px', 'grey', '0.5'])}>
            <ScaleLight />
            <TooltipBlock />
          </div>

          <div className='f-row'
          style={style(['100%', '29px', 'blue', '0.5'])}>
            <Pad params={['9px','100%','black']} />
            <PatternLabelStrip />
          </div>

          <MainKeysStrip />
          <EditCommands />
          <InstrumentLabelStrip />
      </div>
    </div>
  )
}

/**
 * EditCommand component - Renders a single edit command button
 * 
 * @param {Object} props - Component properties
 * @param {string} props.command_name - The name of the command to display on the button
 * @param {number} props.status - Status code that determines if the button is enabled
 * @returns {JSX.Element} A styled button for pattern editing commands
 */
function EditCommand ({command_name, status}) {
  const styling = {width: 79, height: 22, marginTop: 10, 
    fontSize: "100%", cursor: 'pointer',
  }
  // Determine button status based on engine state
  const gs = engine.getEditKeyStatus(status)
  const new_status = gs?"":engine.editKeysDisable
  const color = 'editKey' + new_status + ' text-center-only'
  const [isActive, setIsActive] = useState(false)
  engine.StateSetters[command_name] = setIsActive

  const editCommand = <button 
  id={command_name}
  className={!isActive?color:color + ' editKey-active box '} 
  style={styling}
  onClick={e => !engine.isOngoingAlert&&engine.consumeEditKey(command_name, undefined, e.altKey)}>
    <div 
    style={{transform: `scale(${engine.labelZoom()*1.2})`}}
    >{command_name}    
    </div>
    
  </button> 
  return <Tooltip id={command_name} payload={editCommand}></Tooltip>
}

/**
 * EditCommandLoad component - Special edit command button for loading files
 * 
 * This component renders a file input disguised as a button that allows
 * users to load pattern files from their device.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.command_name - The name of the command (should be 'LOAD')
 * @returns {JSX.Element} A styled label with hidden file input
 */
function EditCommandLoad ({command_name}) {
  const styling = {width: 79, height: 22, marginTop: 10, 
    fontSize: "100%", cursor: 'pointer'
  }
  const [_, setIsActive] = useState(false)
  const new_status = engine.getEditKeyStatus(1)?"":engine.editKeysDisable
  engine.StateSetters[command_name] = setIsActive

  /**
   * Handles file selection and processes the loaded file
   * @param {Event} e - The change event from the file input
   */
  const onChange = async (e) => {
    let file_name = e.target.files[0].name
    file_name.slice(-10)==='.tr909bank'||file_name.slice(-12)==='.tr909preset'
    ?await engine.consumeEditKey(command_name, e.target.files[0], false, file_name)
    :engine.dataFormatErr("DATA", )
    if (document.getElementById('loadedFile')) {
      document.getElementById('loadedFile').value = ''
    }
    return
  }

  /**
   * Shows an alert if user tries to overwrite factory presets
   * @param {Event} e - The click event
   */
  const handleAlert = (e) => {
    let message
    if (engine.isFactoryPlayed()) {
      message = "OK @FACTORY BANK OR PRESET CANNOT BE OVERWRITTEN"
      e.preventDefault()
    }

    engine.Alert([ message, (OK)=>{ engine.Alert() }, false ])
  }
  const editCommandLoad = <label
  id={command_name}
  className={'editKey text-center loadKey ' + new_status} 
  style={styling}
  onChange={onChange}
  > 
    <div 
    style={{transform: `scale(${engine.labelZoom()*1.2})`}}
    >{command_name}    
    </div>

    <input 
    onClick={e => {
      if (engine.isOngoingAlert) {
        e.preventDefault()
        return
      }
      handleAlert(e)
    }}
    type="file" id="loadedFile" style={{display: 'none'}} />
  </label>

  return <Tooltip id={command_name} payload={editCommandLoad}></Tooltip>
}

/**
 * EditCommands component - Renders a row of edit command buttons
 * 
 * This component displays a horizontal strip of command buttons that allow the user
 * to perform various operations on patterns such as copying, inserting, deleting,
 * saving, recalling, and loading.
 * 
 * @returns {JSX.Element} A row of edit command buttons
 */
function EditCommands() {
  const [_, makeReload] = useState(false)
  engine.StateSetters["EC"] = makeReload
  return <div
  className='f-row'
  style={style(['100%', '37px', 'blue'], {
    justifyContent: 'end',
  })}
  >
    <Tooltip id={'legacy_numbar'} payload={''} width='100%' height='100%'/>
    <EditCommand command_name={'COPY'} status={6}/>
    <EditCommand command_name={'INS/UNDO'} status={5}/>
    <EditCommand command_name={'DEL'} status={4}/>
    <EditCommand command_name={'SAVE'} status={3}/>
    <EditCommand command_name={'RECALL'} status={2}/>
    <EditCommandLoad command_name={'LOAD'}/>
    <Pad params={[10,'100%','black']} />
  </div>
}

/**
 * BeatLight component - Displays a visual indicator that blinks with the beat
 * 
 * This component renders a circular light that blinks in sync with the rhythm.
 * It uses state to control the blinking effect and registers with the engine
 * to receive beat timing updates.
 * 
 * @returns {JSX.Element} A div that visually represents the beat
 */
function BeatLight () {
  const [blink, setBeatLightBlink] = useState(false)
  engine.StateSetters['setBeatLightBlink'] = setBeatLightBlink
  useEffect(() => {
    engine.startBeatBlinking()
  }, [])

  return <div
    style={style([66, 66, ''], {
      marginTop: 30,
      marginRight: 7,
      backgroundImage: blink?'radial-gradient(rgba(255, 64, 64, 0.8) 8%, #9198e50f)':'',
    // background: 'radial-gradient(#ff4040 62%, #9198e50f)'
  })}
  ></div>
}

/**
 * BeatRunner component - Controls the position of the beat light
 * 
 * This component manages the horizontal position of the beat light,
 * allowing it to move in sync with the sequencer's timing.
 * 
 * @returns {JSX.Element} A container for the beat light with positioning
 */
function BeatRunner () {
  const [beatLightX, setBeatLightX] = useState(88)
  engine.StateSetters['setBeatLightX'] = setBeatLightX

  return (
    <div 
    className='f-row'
    // 23, 49, 75, 101
    style={style([beatLightX, '100%' , 'white'], {
      justifyContent: 'end',
      alignItems: 'center',
    })}
    > 
      <BeatLight />
    </div>
  )
}

/**
 * SpreadInstrumentLabel component - Renders a pair of instrument labels with flam controls
 * 
 * This component displays two related instrument labels (like "CLOSED" and "OPEN" for hi-hats)
 * with support for flam effects. It handles user interactions for setting flam states.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.label - Text for the first instrument label
 * @param {string} props.label2 - Text for the second instrument label
 * @param {number} props.idx - Index identifier for the instrument
 * @param {string} props.debugColor - Color used for debugging layout
 * @returns {JSX.Element} A container with two instrument labels
 */
function SpreadInstrumentLabel({label, label2, idx, debugColor=''}) {
  const [isActive, setIsActive] = useState(false)
  // const [isActive2, setIsActive2] = useState(false)
  const [isFlammed, setIsFlammed] = useState(false)
  const [isFlammed2, setIsFlammed2] = useState(false)
  engine.StateSetters[idx + 32] = [setIsActive, setIsFlammed]
  engine.StateSetters[idx+'O'] = [setIsActive, setIsFlammed2]

  const handleClick = (idx, state_, setter) => {
    if (engine.GLOBAL_LED_CONTROL_VARIABLE() ==='SHUFF /FLAM'&&
      engine.TRACK_WRITE) {
      setter(state => !state)
      if (isFlammed2) {
        if (isFlammed) {
          engine.writeFlammedINST(idx, 2) 
          return 
        }
        engine.writeFlammedINST(idx, 3) 
        return
      }
      engine.writeFlammedINST(idx, !state_)
    }
  }
  const handleClickOpen = (idx, state_, setter) => {
    if (engine.GLOBAL_LED_CONTROL_VARIABLE() ==='SHUFF /FLAM'&&
      engine.TRACK_WRITE) {
      setter(state => !state)
      if (isFlammed) {
        if (isFlammed2) {
          engine.writeFlammedINST(idx, 1) 
          return 
        }
        engine.writeFlammedINST(idx, 3) 
        return
      }
      engine.writeFlammedINST(idx, !state_ * 2)
      
    }
  }

  const cursor = engine.isShuffleFlam()?'pointer':'auto'
  const scale = `scale(${engine.labelZoom()})`

  const instrumentLeft = <span
  id={idx+'ssi'}
  className={(isActive ? 'text-center text-orange-color':'text-center') }
  onClick={()=> handleClick(idx, isFlammed, setIsFlammed)}
  style={{fontStyle: isFlammed&&'italic', 
    cursor: cursor,
    marginRight: 25,
    transform: scale
  }}
  >{label}</span>

  const instrumentRight = <span
  id={2*idx+'ssi'}
  className={(isActive ? 'text-center text-orange-color':'text-center')}
  style={{fontStyle: isFlammed2&&'italic', 
    cursor: cursor,
    transform: scale}}
  onClick={()=> handleClickOpen(idx, isFlammed2, setIsFlammed2)}
  >{label2}</span>

  return <div
  className={'text-center-only'}
  style={style(['158px', '100%', debugColor])}
  >
    <Tooltip id={label} payload={instrumentLeft}></Tooltip>
    <Tooltip id={label2} payload={instrumentRight}></Tooltip>
  </div>
}

/**
 * DoubleInstrumentLabel component - Renders a pair of instrument labels with flam controls
 * 
 * Similar to SpreadInstrumentLabel but with different layout and behavior.
 * Used for instrument pairs like RIM/CLAP and CRASH/RIDE.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.label - Text for the first instrument label
 * @param {string} props.label2 - Text for the second instrument label
 * @param {string} props.spread - Spacing between the two labels
 * @param {number} props.idx - Index identifier for the instrument
 * @param {string} props.debugColor - Color used for debugging layout
 * @returns {JSX.Element} A container with two instrument labels
 */
function DoubleInstrumentLabel({
  label, label2, spread, idx, debugColor=''}) {
  const [isActive, setIsActive] = useState(false)
  const [isActive2, setIsActive2] = useState(false)
  const [isFlammed, setIsFlammed] = useState(false)
  const [isFlammed2, setIsFlammed2] = useState(false)

  engine.StateSetters[idx + 32] = [setIsActive, setIsFlammed]
  engine.StateSetters[idx + 1 + 32] = [setIsActive2, setIsFlammed2]

  const handleClick = (idx, state_, setter) => {
    if (engine.GLOBAL_LED_CONTROL_VARIABLE() ==='SHUFF /FLAM'&&
      engine.TRACK_WRITE) {
      setter(state => !state)
      engine.writeFlammedINST(idx, !state_)
    }
  }

  const cursor = engine.isShuffleFlam()?'pointer':'auto'
  const scale = `scale(${engine.labelZoom()})`

  const instrumentLeft = <span
  id={idx+"ssi"}
  className={(isActive ? 'text-center text-orange-color':'text-center')}
  onClick={()=> handleClick(idx, isFlammed, setIsFlammed)}
  style={{fontStyle: isFlammed&&'italic', 
    cursor: cursor,
    marginRight: spread,
    transform: scale
  }}
  >{label}</span>

  const instrumentRight = <span
  id={Number(idx+1)+"ssi"}
  className={(isActive2 ? 'text-center text-orange-color':'text-center')}
  onClick={()=> handleClick(idx+1, isFlammed2, setIsFlammed2)}
  style={{fontStyle: isFlammed2&&'italic', 
    cursor: cursor,
    transform: scale
  }}
  >{label2}</span>

  return <div
  className={'text-center-only'}
  style={style(['158px', '100%', debugColor])}
  >
    <Tooltip id={label} payload={instrumentLeft}></Tooltip>
    <Tooltip id={label2} payload={instrumentRight}></Tooltip>
  </div>
}

/**
 * InstrumentLabel component - Renders a single instrument label with flam control
 * 
 * This component displays a single instrument name with support for flam effects
 * and active state highlighting.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.label - Text for the instrument label
 * @param {number} props.idx - Index identifier for the instrument
 * @param {string} props.width - Width of the label container
 * @param {string} props.height - Height of the label container
 * @param {string} props.debugColor - Color used for debugging layout
 * @returns {JSX.Element} A container with an instrument label
 */
function InstrumentLabel({label, idx, width='158px', height='100%', debugColor=''}) {
  const [isActive, setIsActive] = useState(false)
  const [isFlammed, setIsFlammed] = useState(false)

  engine.StateSetters[idx + 32] = [setIsActive, setIsFlammed]

  // idx 10 is TOTAL ACCENT track, no flam for this track is written
  const handleClick = () => {
    if (engine.GLOBAL_LED_CONTROL_VARIABLE() ==='SHUFF /FLAM'&&
      engine.TRACK_WRITE&&idx!==10) {
      setIsFlammed(state => !state)
      engine.writeFlammedINST(idx, !isFlammed)
    }
  }

  const cursor = engine.isShuffleFlam()&&idx!==10?'pointer':'default'
  const scale = `scale(${engine.labelZoom()})`

  const instrumentLabel = <div  
    className={(isActive ? 'text-center text-orange-color':'text-center')}
    style={style([width, height, debugColor], {
      fontStyle: isFlammed&&'italic', 
      cursor: cursor,
    })}
    onClick={handleClick}
    ><span
      style={{transform: scale}}
      id={idx+"ssi"}
    >
      {label}
    </span>
  </div>

  return <Tooltip id={label} payload={instrumentLabel}></Tooltip>
}

/**
 * InstrumentLabelStrip component - Renders a row of instrument labels
 * 
 * This component displays all instrument labels in a horizontal strip at the top
 * of the drum machine interface.
 * 
 * @returns {JSX.Element} A row of instrument labels
 */
function InstrumentLabelStrip() {
  const [_, makeReload] = useState(0)
  engine.StateSetters['ils-r'] = makeReload

  return <div className='f-row'
  style={style(['100%', '20px', 'blue', '0.5'])}>
    <Pad params={['9px','100%','black']} />
    <InstrumentLabel label='BASS DRUM' idx={0} debugColor='red'/>
    <InstrumentLabel label='SNARE DRUM' idx={1} debugColor='yellow'/>
    <InstrumentLabel label='LOW TOM' idx={2} debugColor='red'/>
    <InstrumentLabel label='MID TOM' idx={3} debugColor='yellow'/>
    <InstrumentLabel label='HI TOM' idx={4} debugColor='red'/>
    <DoubleInstrumentLabel label='RIM' label2='CLAP'
    spread={40}
    idx={5} debugColor='yellow'/>
    <SpreadInstrumentLabel label={'CLOSED'} label2={'OPEN'} 
    idx={7} debugColor='red' />
    <DoubleInstrumentLabel label='CRASH' label2='RIDE'
    spread={40}
    idx={8} debugColor='yellow'/>
  </div>
}

/**
 * PatternLabel component - Renders a pattern number label
 * 
 * This component displays a pattern number with optional marking characters
 * and highlights the active pattern.
 * 
 * @param {Object} props - Component properties
 * @param {number} props.label - Pattern number to display
 * @param {string} props.debugColor - Color used for debugging layout
 * @param {string} props.markChar - Character used to mark special patterns
 * @returns {JSX.Element} A pattern number label
 */
function PatternLabel({label, debugColor='', markChar='|'}) {
  const [isActive, setIsActive] = useState(false)
  engine.StateSetters[label + 15] = setIsActive
  
  // Swing and Flam mark
  const [mark, setMark] = useState (label===1||label===9?true:false)
  engine.StateSetters[label + 58] = setMark

  // Maps even-numbered pattern labels to QWERTY keyboard keys (e.g. 2 -> 'W - 2')
  // Maps odd-numbered pattern labels to keyboard numbers (e.g. 1 -> '1 - 1', 3 -> '2 - 3')
  label = label % 2 === 0 ? engine.QWERTYUI[label/2 - 1] + ' - ' + label : label/2 + 0.5 + ' - ' + label

  const patternLabel = <span
  style={{transform: `scale(${engine.labelZoom()*1.1})`}}>
  {mark&&markChar}&nbsp;{label}&nbsp;{mark&&markChar}
  </span>

  return <div
    className={(isActive?'text-center text-orange-color':'text-center')}
    style={style(['79px', '100%', debugColor], {
      background: 'none'
    })}
    >
      <Tooltip id={'pL'} payload={patternLabel}></Tooltip>
    </div>
}

/**
 * PatternLabelStrip component - Renders a row of pattern number labels
 * 
 * This component displays all pattern numbers (1-16) in a horizontal strip.
 * 
 * @returns {Array<JSX.Element>} An array of pattern number labels
 */
function PatternLabelStrip() {
  let list = []
  for(let i= 1; i <= 16; i++) {
    list.push(
    <PatternLabel key={i+15} label={i} debugColor={i%2===0?'red':'yellow'}/>)
  }
  return list
}


import OrangePointer from './assets/TR-909-orange-pointer.svg';

/**
 * Gets the default value for a rotary control based on its ID
 * 
 * @param {string} elementId - The ID of the rotary control
 * @returns {number} The default value for the rotary control
 */
const getDefaultForRotaries = (elementId) => {
  switch (elementId) {
    case 'tempo_wheel': return 0 // 128bpm
    case 'volume_wheel': return 90 // 80%
    case 'AC': return -150 // 0
    default: return 0
  }
}

let firstY = 0
/**
 * Sets the initial Y position for drag operations
 * 
 * @param {number} clientY - The client Y coordinate
 */
const setFirstY = (clientY) => {firstY = clientY}
let mouseDown = false 
/**
 * Sets the mouse down state for drag operations
 * 
 * @param {boolean} truth - Whether the mouse is down
 */
const setMouseDown = (truth) => {mouseDown = truth}

/**
 * Gets the rotation increment for a rotary control based on its ID
 * 
 * @param {string} elementId - The ID of the rotary control
 * @returns {number} The rotation increment value
 */
const getRotIncrement = (elementId) => {
  switch (elementId) {
    case 'tempo_wheel': return 0.8433333333333334
    default: return 2
  } 
}

/**
 * Determines if a rotary control should respond to input based on conditions
 * 
 * @param {string} elementId - The ID of the rotary control
 * @returns {boolean} Whether the control should respond to input
 */
const handleINSTOnCondition = (elementId) => {
  let truth = true
  
  if (elementId === 'tempo_wheel' 
    && engine.GLOBAL_LED_CONTROL_VARIABLE() !== 'TEMPO'
  ) {truth = false}

  return truth
}

/**
 * RotaryWheel component - Renders a rotary control knob
 * 
 * This component displays a rotary control that can be adjusted by mouse, touch,
 * or keyboard input. It handles various input methods and updates the engine state.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.elementId - Unique identifier for the control
 * @param {string|number} props.width - Width of the control
 * @param {string|number} props.height - Height of the control
 * @param {string} props.srcSVG - Source path for the control's SVG image
 * @param {string} props.altSVG - Alternative SVG image for active state
 * @param {number} props.maxDegree - Maximum rotation degree
 * @param {number} props.dragSpeed - Speed of rotation when dragging
 * @returns {JSX.Element} A rotary control knob
 */
function RotaryWheel({
  elementId, width, height,
  srcSVG, altSVG,
  maxDegree=150, dragSpeed=7}) {
  
  // State for the rotation degree of the wheel
  const [rootDeg, setRootDeg] = useState(getDefaultForRotaries(elementId))
  // State to track if the wheel is currently being interacted with
  const [isActive, setIsActive] = useState(false)
  // State to track if this was the last active rotary control
  const [lastActive, setLastActive] = useState(false)
  // State to track if haptic feedback is supported
  const [hapticSupported, setHapticSupported] = useState(false)
  
  // Reference to the wheel element
  const wheelRef = useRef(null)

  // Check if haptic feedback is available on this device
  useEffect(() => {
    setHapticSupported('vibrate' in navigator);
  }, []);

  // Function to trigger haptic feedback
  const triggerHapticFeedback = useCallback(() => {
    if (hapticSupported) {
      navigator.vibrate(8); // Short 8ms vibration for subtle feedback
    }
  }, [hapticSupported]);

  // Register state setters for non-tempo and non-volume wheels
  useEffect(() => {
    if (elementId !== 'tempo_wheel' && elementId !== 'volume_wheel') {
      engine.StateSetters[elementId+'law'] = setLastActive
    }
    
    // Clean up when component unmounts
    return () => {
      if (elementId !== 'tempo_wheel' && elementId !== 'volume_wheel') {
        delete engine.StateSetters[elementId+'law']
      }
    }
  }, [elementId])
  
  // Effect to update engine state when rotation changes
  useEffect(() => {
    engine.setRotaryValue(elementId, rootDeg, setRootDeg)
    engine.setDisplay(elementId)
  }, [rootDeg, elementId])

  // Effect to manage event listeners for preventing default behaviors
  useEffect(() => {
    const element = wheelRef.current
    if (!element) return
    
    // Always prevent default for these events to prevent page scrolling
    const preventDefaultHandler = (event) => {
      event.preventDefault()
    }
    
    // Add event listeners with proper handlers that can be removed
    element.addEventListener('wheel', preventDefaultHandler, { passive: false })
    element.addEventListener('touchmove', preventDefaultHandler, { passive: false })
    element.addEventListener('keydown', preventDefaultHandler, { passive: false })
    
    // Clean up listeners on unmount
    return () => {
      element.removeEventListener('wheel', preventDefaultHandler)
      element.removeEventListener('touchmove', preventDefaultHandler)
      element.removeEventListener('keydown', preventDefaultHandler)
    }
  }, []);

  /**
   * Updates rotation value within constraints
   * @param {number} delta - Amount to change rotation by
   * @param {number} amount - How much to change by (default is the rotation increment)
   */
  const updateRotation = useCallback((delta, amount) => {
    if (!handleINSTOnCondition(elementId)) return
    
    const increment = amount || getRotIncrement(elementId);
    
    if (delta > 0) {
      if (rootDeg >= maxDegree) return
      setRootDeg(prev => Math.min(prev + increment, maxDegree))
      triggerHapticFeedback()
    } else {
      if (rootDeg <= -maxDegree) return
      setRootDeg(prev => Math.max(prev - increment, -maxDegree))
      triggerHapticFeedback()
    }
    
    engine.setLastActive(elementId)
  }, [rootDeg, elementId, maxDegree, triggerHapticFeedback])

  /**
   * Handles mouse wheel rotation events
   * @param {WheelEvent} e - The wheel event
   */
  const handleRotation = useCallback((e) => {
    // e.preventDefault(); // Prevent scrolling
    setIsActive(true)
    updateRotation(e.deltaY > 0 ? 1 : -1)
  }, [updateRotation])

  /**
   * Handles keyboard arrow key events for rotation
   * @param {KeyboardEvent} e - The keyboard event
   */
  const onKeyDown = useCallback((e) => {
    if (!handleINSTOnCondition(elementId)) return
    setIsActive(true)
    
    if (e.code === "ArrowDown") {
      updateRotation(1)
    } else if (e.code === "ArrowUp") {
      updateRotation(-1)
    }
  }, [elementId, updateRotation])

  /**
   * Handles mouse drag events for rotation
   * @param {MouseEvent} e - The mouse event
   */
  const handleDrag = useCallback((e) => {
    if (!mouseDown || !handleINSTOnCondition(elementId)) return
    setIsActive(true)
    
    const currentY = e.clientY
    const delta = currentY - firstY
    
    if (delta !== 0) {
      // Use the original dragSpeed parameter directly for faster response
      if (delta > 0) {
        if (rootDeg >= maxDegree) return
        setRootDeg(prev => Math.min(prev + dragSpeed, maxDegree))
        triggerHapticFeedback()
      } else {
        if (rootDeg <= -maxDegree) return
        setRootDeg(prev => Math.max(prev - dragSpeed, -maxDegree))
        triggerHapticFeedback()
      }
      setFirstY(currentY)
      engine.setLastActive(elementId)
    }
  }, [elementId, rootDeg, maxDegree, dragSpeed, triggerHapticFeedback])

  /**
   * Resets the rotary control to its default value on double click
   */
  const handleDoubleClick = useCallback(() => {
    if (!handleINSTOnCondition(elementId)) return
    setRootDeg(getDefaultForRotaries(elementId))
    engine.setLastActive(elementId)
    triggerHapticFeedback()
  }, [elementId, triggerHapticFeedback])

  // State to track if the wheel is being dragged
  const [isDragging, setIsDragging] = useState(false)

  // Handle global mouse move events
  const handleGlobalMouseMove = useCallback((e) => {
    if (!mouseDown || !handleINSTOnCondition(elementId)) return
    
    const currentY = e.clientY
    const delta = currentY - firstY
    
    if (delta !== 0) {
      // Use the original dragSpeed parameter directly for faster response
      if (delta > 0) {
        if (rootDeg >= maxDegree) return
        setRootDeg(prev => Math.min(prev + dragSpeed, maxDegree))
        triggerHapticFeedback()
      } else {
        if (rootDeg <= -maxDegree) return
        setRootDeg(prev => Math.max(prev - dragSpeed, -maxDegree))
        triggerHapticFeedback()
      }
      setFirstY(currentY)
      engine.setLastActive(elementId)
    }
  }, [elementId, rootDeg, maxDegree, dragSpeed, triggerHapticFeedback])

  // Handle global touch move events
  const handleGlobalTouchMove = useCallback((e) => {
    e.preventDefault(); // Prevent scrolling
    if (!mouseDown || !handleINSTOnCondition(elementId)) return
    
    const dragSpeedIOS = elementId === 'tempo_wheel' ? 1 : elementId === 'volume_wheel' ? 2 : 4
    const touch = e.touches[0]
    const currentY = touch.clientY
    const delta = currentY - firstY
    
    if (delta !== 0) {
      if (delta > 0) {
        if (rootDeg >= maxDegree) return
        setRootDeg(prev => Math.min(prev + dragSpeedIOS, maxDegree))
        triggerHapticFeedback()
      } else {
        if (rootDeg <= -maxDegree) return
        setRootDeg(prev => Math.max(prev - dragSpeedIOS, -maxDegree))
        triggerHapticFeedback()
      }
      
      setFirstY(currentY)
      engine.setLastActive(elementId)
    }
  }, [elementId, rootDeg, maxDegree, triggerHapticFeedback])

  // Handle global mouse up events
  const handleGlobalMouseUp = useCallback(() => {
    setMouseDown(false)
    setIsActive(false)
    setIsDragging(false)
  }, [])

  // Handle global touch end events
  const handleGlobalTouchEnd = useCallback(() => {
    setMouseDown(false)
    setIsActive(false)
    setIsDragging(false)
  }, [])

  // Setup and cleanup global event listeners when dragging state changes
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove)
      document.addEventListener('mouseup', handleGlobalMouseUp)
      document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false })
      document.addEventListener('touchend', handleGlobalTouchEnd)
    }
    
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
      document.removeEventListener('touchmove', handleGlobalTouchMove)
      document.removeEventListener('touchend', handleGlobalTouchEnd)
    }
  }, [isDragging, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalTouchMove, handleGlobalTouchEnd])

  /**
   * Handles mouse down/up events
   * @param {MouseEvent} e - The mouse event
   */
  const handleMouseDown = useCallback((e) => {
    e.preventDefault(); // Ensure no unwanted behavior
    setMouseDown(true)
    setIsActive(true)
    setIsDragging(true)
    setFirstY(e.clientY || (e.touches && e.touches[0].clientY) || 0)
  }, [])

  const handleTouchStart = useCallback((e) => {
    e.preventDefault(); // Ensure no unwanted behavior
    setMouseDown(true)
    setIsActive(true)
    setIsDragging(true)
    setFirstY(e.touches[0].clientY || 0)
  }, [])

  const handleMouseUp = useCallback(() => {
    setMouseDown(false)
    setIsActive(false)
    setIsDragging(false)
  }, [])

  // Calculate dynamic height based on elementId
  const dynamicHeight = useMemo(() => {
    const firstChar = elementId.slice(0, 1)
    return `${firstChar === firstChar.toUpperCase() ? 85 : 95}%`
  }, [elementId])

  // Calculate dynamic width based on elementId
  // Safari mobile only layout Tooltip issue
  const dynamicWidth = useMemo(() => {
    const firstChar = elementId.slice(0, 1)
    return `${firstChar === firstChar.toUpperCase() ? 77 : 65}%`
  }, [elementId])

  // Determine image source based on active state
  const imageSrc = useMemo(() => {
    return lastActive && elementId !== 'tempo_wheel' && elementId !== 'volume_wheel'
      ? altSVG
      : srcSVG
  }, [lastActive, elementId, altSVG, srcSVG])

  const wheelButton = <button
  ref={wheelRef}
  id={elementId}
  className='box_'
  onDrag={handleDrag}
  onWheel={handleRotation}
  onDoubleClick={handleDoubleClick}
  onMouseDown={handleMouseDown}
  onMouseUp={handleMouseUp}
  onTouchStart={handleTouchStart}
  onTouchEnd={handleMouseUp}
  onKeyDown={onKeyDown}
  style={{
    width: '65%',
    height: dynamicHeight,
    borderRadius: 40,
    background: 'transparent',
    position: 'absolute',
    zIndex: 2,
    fontSize: '200%',
    color: 'rgb(30, 236, 254)',
    boxShadow: boxShadow
  }}
>
</button>  

  return (
    <div
      className='f-col-cen'
      style={{
        width,
        height,
        justifyContent: 'center',
        position: 'relative'
      }}
    >
      {/* Invisible button that captures user interactions */}
      <Tooltip id={elementId} payload={wheelButton} width={engine.isMobile ? dynamicWidth : '65%'} height={'auto'}/>
      {/* Container for the rotary wheel image */}
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          transform: `rotate(${rootDeg}deg)`,
          backgroundColor: debug && 'blue',
          willChange: 'transform',
          position: 'relative'
        }}
      >
        {/* The rotary wheel image that rotates */}
        <img
          style={{ outline: 'none' }}
          tabIndex={0}
          className='transform'
          draggable='false'
          width='100%'
          height='100%'
          src={imageSrc}
          alt={`${elementId} control`}
        />   
      </div>
    </div>
  )
}

/**
 * TrackKeys component - Renders track selection buttons
 * 
 * This component displays a row of LED buttons for selecting tracks.
 * 
 * @returns {JSX.Element} A group of track selection buttons
 */
function TrackKeys () {
  const [isClicked, seIsClicked] = useState(0)
  engine.StateSetters['TrackKeys'] = seIsClicked
  return <>
    <LedKey elementId={'T1'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'T2'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'T3'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'T4'} />
    <Pad params={['29px', '100%', 'red']}/>
  </>
}

/**
 * PatternGroupKeys component - Renders pattern group selection buttons
 * 
 * This component displays a row of LED buttons for selecting pattern groups.
 * 
 * @returns {JSX.Element} A group of pattern group selection buttons
 */
function PatternGroupKeys () {
  const [isClicked, seIsClicked] = useState(0)
  engine.StateSetters['PatternGroupKeys'] = seIsClicked
  return <>
    <LedKey elementId={'PG1'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'PG2'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'PG3'} />
    <Pad params={['12px', '100%', 'red']}/>
  </>
}

/**
 * BankKeys component - Renders bank selection buttons
 * 
 * This component displays a row of LED buttons for selecting banks.
 * 
 * @returns {JSX.Element} A group of bank selection buttons
 */
function BankKeys () {
  const [isClicked, setIsClicked] = useState(0)
  engine.StateSetters['BankKeys'] = setIsClicked
  return <>
    <LedKey elementId={'B1'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'B2'}/>
    <Pad params={['16px', '100%', 'red']}/>
  </>
}

/**
 * StepTapKeys component - Renders step and tap mode buttons
 * 
 * This component displays buttons for controlling step and tap modes.
 * 
 * @returns {JSX.Element} Step and tap mode buttons
 */
function StepTapKeys () {
  const [isClicked, setIsClicked] = useState(0)
  engine.StateSetters['StepTapKeys'] = setIsClicked
  return <>
    <LedKey elementId={'TEMPO-STEP'} />
    <Pad params={['12px', '100%', 'red']}/>
    <LedKey elementId={'BACK-TAP'} />
    <Pad params={['12px', '100%', 'red']}/>
  </>
}

/**
 * TotalAccent component - Renders the total accent control
 * 
 * This component displays the total accent control with its label.
 * 
 * @returns {JSX.Element} The total accent control
 */
function TotalAccent() {
  const [_, makeReload] = useState(0)
  engine.StateSetters['TA-r'] = makeReload
  return <div 
  className='f-col-cen'
  style={style(['66px','100%','blue','0.1'])}>
    <Pad params={['100%', '35px', 'yellow', '0.8']}/>
    <MainKey elementId={'CE-TA'} INST={'AC'}/>
    <InstrumentLabel label={'TOTAL ACCENT'} idx={10} debugColor='blue' height='24px'/>
  </div>
}

/**
 * MidSection component - Renders the middle section of the drum machine
 * 
 * This component displays the central controls including start/stop buttons,
 * tempo display, and various control buttons.
 * 
 * @returns {JSX.Element} The middle section of the interface
 */
function MidSection() {
  return (
    <div className='mid-section'>
      <Pad params={['21px', '100%', 'violet', '0.1']}/>
      
      {/* START */}
      <div 
      className='f-col-cen'
      style={style(['66px','100%','blue','0.1'])}>
        <Pad params={['100%', '35px', 'red', '0.8']}/>
        <MainKey elementId={'START'}/>
      </div>

      <Pad params={['20px', '100%', 'violet', '0.1']}/>

      {/* STOP */}
      <div 
      className='f-col-cen'
      style={style(['66px','100%','blue','0.1'])}>
        <Pad params={['100%', '35px', 'yellow', '0.8']}/>
        <MainKey elementId={'STOP'} />
      </div>

      <Pad params={['36px', '100%', 'violet', '0.1']}/>

      {/* meas/tempo  */}
      <div
      className='f-col-cen'
      style={style(['139px','100%'])}>
        <Pad params={['100%', '35px', 'yellow', '0.2']}/>
        {/* <div style={{
          width: '120%', height: '100%', marginTop: '0%', marginLeft: '5%',
          transform: `scale(${engine.labelZoom()*1.1})`}}> */}
        <LedDisplay />
        {/* </div> */}
        
      </div> 

      <Pad params={['15px','100%','red','0.8']}/>

      {/* TEMPO */}
      <div
      className='f-col-cen'
      style={style(['136px','100%','red','0.5'])}>
          <Pad params={['100%','19px','violet']}/>
          {/* enclosing div */}
          <div
          className='f-col-cen'
          style={{
            display: 'flex',
            width: '100%',
            height: '100px',
            backgroundColor: debug && 'black',
            justifyContent: 'center',
          }}>
            <RotaryWheel 
              elementId={'tempo_wheel'}
              width={'116px'} height={'86%'}
              srcSVG={OrangePointer}
              dragSpeed={1}
            />
          </div>
      </div> 

      <Pad params={['32px', '100%', 'violet', '0.1']}/>

      {/* led keys */}
      <div
      className='f-col-cen'
      style={style(['614px','100%','black','0.7'])}>
        <Pad params={['100%', '35px', 'yellow', '0.8']}/>

        {/* colum holding all the keys */}
        <div
        className='f-row'
        style={style(['100%','30px','black','0.9'])}>
          <TrackKeys />

          <PatternGroupKeys />
          <LedKey elementId={'EXT'}/>

          <Pad params={['29px', '100%', 'red']}/>
          <StepTapKeys />

          <BankKeys />
          <LedKey elementId={'CG'}/>
          <Pad params={['12px', '100%', 'red']}/>
          <LedKey elementId={'TS-PM'}/>
        </div>
      </div> 

      <Pad params={['34px', '100%', 'violet','0.1']}/>

      <TotalAccent />

      <Pad params={['39.5px', '100%', 'violet', '0.1']}/>

      {/* VOLUME */}
      <div
      className='f-col-cen'
      style={style(['114px','100%','red','0.5'])}>
        <Pad params={['100%', '19px', 'violet']}/>

        <div
        className='f-col-cen'
        style={{
          display: 'flex',
          width: '100%',
          height: '100px',
          backgroundColor: debug && 'black',
          justifyContent: 'center',
        }}>
          <RotaryWheel 
            elementId={'volume_wheel'}
            width={'114px'} height={'86%'}
            srcSVG={OrangePointer}
            dragSpeed={2}
          />

        </div>

      </div>
    </div>
  )
}

import BluePointerSmall from './assets/TR-909-blue-pointer-small.svg';
import OrangePointerSmall from './assets/TR-909-orange-pointer-small.svg';
import initiateEngine from './features/Engine';

/**
 * Renders a small rotary wheel enclosed in a container
 * @param {string} elementId - Unique identifier for the rotary wheel
 * @returns {JSX.Element} A small rotary wheel component
 */
function SmallRWEnclosed ({elementId}) {
  return <div style={{
    display: 'flex',
    width: '60px',
    height: '100%',
    backgroundColor: debug && 'violet',
    justifyContent: 'center',
  }}>
    <RotaryWheel 
      elementId={elementId}
      width={'60px'} height={'100%'}
      srcSVG={OrangePointerSmall}
      altSVG={BluePointerSmall}
      dragSpeed={3}
    />
  </div>
}

/**
 * Renders the sound section containing all sound parameter controls
 * @returns {JSX.Element} The sound section component with rotary controls
 */
function SoundSection() {
  return (
    <div
    id='soundSection'
    style={style(['', '', '#00ff953e'])}
    className='sound-section'>
      <Pad params={['100%', '51px', 'black', '0.4']}/>

      {/* Rotaries strip-1 - Main level and tuning controls */}
      <div
      className='f-row'
      style={style(['100%','52px','red','0.4'])}>
        <Pad params={['138px', '100%', 'yellow', '0.4']}/>
        <SmallRWEnclosed elementId={'BDtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'BDlev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'SDtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'SDlev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'LTtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'LTlev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'MTtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'MTlev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'HTtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'HTlev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'RSlev'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'HClev'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'HHlev'}/>
        <Pad params={['101px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'CRlev'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'RDlev'}/>
      </div>

      <Pad params={['100%', '16.5px', 'black', '0.4']}/>
      {/* Rotaries strip-2 - Secondary sound parameters */}
      <div
      className='f-row'
      style={style(['100%','52px','red','0.4'])}>
        <Pad params={['35px', '100%', 'yellow', '0.4']}/>
        <SmallRWEnclosed elementId={'AC'}/>
        <Pad params={['43px', '100%', 'yellow', '0.4']}/>
        <SmallRWEnclosed elementId={'BDatt'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'BDdec'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'SDton'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'SDsna'}/>
        <Pad params={['25px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'LTdec'}/>
        <Pad params={['98px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'MTdec'}/>
        <Pad params={['98px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'HTdec'}/>
        <Pad params={['256px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'CHdec'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'OHdec'}/>
        <Pad params={['28px', '100%', 'yellow', '0.6']}/>
        <SmallRWEnclosed elementId={'CRtun'}/>
        <Pad params={['13px', '100%', 'green', '0.6']}/>
        <SmallRWEnclosed elementId={'RDtun'}/>
      </div>
    </div>
  )
}

/**
 * Renders a single pattern slot in the queue table
 * @param {number} patternAddress - The index of the pattern in the queue
 * @param {number} scale - Scale factor for the text display
 * @returns {JSX.Element} A pattern slot component
 */
function PatternSlotQueue ({patternAddress, scale}) {
  // State for updating the slot when pattern changes
  const [update, setUpdate] = useState(false)
  engine.StateSetters['QT'+patternAddress] = setUpdate
  
  // Get the pattern data for this slot
  let selectorCode = engine.getPlaybackQueuePattern(patternAddress)

  // State for tracking if this slot is currently active
  const [isActive, setIsActive] = useState(false)
  engine.StateSetters['QTa'+patternAddress] = setIsActive

  /**
   * Handles switching to this pattern when clicked
   * Different behavior based on playback state
   */
  const switchToPattern = () => {
    if (selectorCode){
      // When playing, queue the pattern to play after current pattern finishes
      if (engine.GLOBAL_SSC!=='STOP') {
        engine.setPatternNumber(patternAddress-1)
        return
      }

      // When stopped, switch to the pattern immediately
      engine.switchQTSlot(patternAddress)
      engine.changePattern(selectorCode[3], selectorCode)
      engine.setPatternLocation(selectorCode)
      engine.StateSetters['setSelectedQTSlot'](patternAddress+1)
    }
  }
  
  return <div
    className={(isActive?'qt-slot-active ':'' + 'qt-slot') +' text-center'}
    id={'ps'+patternAddress}
    onClick={switchToPattern}
    style={{width: '2.5%', height: 34, cursor: 'pointer', position: 'relative'}}
    > <div 
    style={{transform: `scale(${scale})`, position: 'absolute'}}
    >
      {selectorCode?selectorCode[3]+1:undefined}
    </div>
    <Tooltip id={'meas'} payload={''} width='100%' height='34px' position='absolute' />
  </div>
}

/**
 * Creates a strip of pattern slots for the queue table
 * @param {number} from - Starting index for the pattern slots
 * @param {number} to - Ending index for the pattern slots
 * @param {number} scale - Scale factor for the text display
 * @returns {Array<JSX.Element>} Array of pattern slot components
 */
function PatternStripQueue ({from, to, scale}) {
  let list = []
  for (let i=from; i<to; i++) {
    list.push(<PatternSlotQueue key={i} patternAddress={i} scale={scale}/>)
  }
  return list
}

/**
 * Renders the queue table that appears on hover
 * Displays all available patterns in a grid layout
 * @returns {JSX.Element|null} The queue table component or null if not visible
 */
function QueueHover () {
  const scale = engine.labelZoom()*1.2
  
  // Create three rows of pattern slots
  let queue = <PatternStripQueue from={0} to={40} scale={scale}/>
  let queue2 = <PatternStripQueue from={40} to={80} scale={scale}/>
  let queue3 = <PatternStripQueue from={80} to={120} scale={scale}/>

  // State for forcing a reload of the table
  const [reload, makeReload] = useState(false)
  engine.StateSetters['TABLEreload'] = makeReload

  // Define the queue table component
  let QueueTable = <div 
    id='QT'
    className='f-col qt-table'
    style = {{
      width: 1281,
      height: 100,
      // backgroundColor: 'rgb(51, 51, 51)', opacity: 0.82,
      color: 'orange',
      position: 'absolute',
      top: 491.5, 
      left: 116.5,
      zIndex: 2,
      backgroundColor: engine.fixedBackgroundColor,
      backgroundImage: engine.BQTConicGradient
    }}
    > 
      <div className='f-row'>{queue}</div>
      <div className='f-row'>{queue2}</div>
      <div className='f-row'>{queue3}</div>
    </div>

  // State for controlling visibility of the queue table
  const [hoverOn, setQueueTableOn] = useState(true)
  engine.StateSetters['setQueueTableOn'] = setQueueTableOn
  
  // Initialize the queue table when it becomes visible
  useEffect(() => {
    hoverOn&&engine.switchQTSlot()
  }, [hoverOn])

  // Only render the table when hoverOn is true
  return hoverOn&&QueueTable
}
/**
 * Renders a factory bank slot in the bank table
 * @param {Object} props - Component properties
 * @param {number} props.slotAddress - The address of the bank slot
 * @returns {JSX.Element} The factory bank component
 */
function FactoryBank ({slotAddress}) {
  // Create a unique ID for this bank
  const bankId = 'FBa'+slotAddress
  // Track if this bank is currently active
  const [isActive, setIsActive] = useState(bankId===engine.currentBank?true:false)
  // State for green highlight effect
  const [green, makeGreen] = useState(false)
  // State for showing input field for name editing (precaution for switching from user bank)
  const [inputField, setSaveField] = useState(false)
  // State for forcing component reload
  const [_, makeReload] = useState(0)

  // Register state setters in engine.StateSetters and clean up on unmount
  useEffect(() => {
    engine.StateSetters[bankId] = setIsActive
    engine.StateSetters[bankId+'g'] = makeGreen
    engine.StateSetters[bankId+'A'] = setSaveField
    engine.StateSetters[bankId+'r'] = makeReload
    return () => {
      delete engine.StateSetters[bankId]
      delete engine.StateSetters[bankId+'g']
      delete engine.StateSetters[bankId+'A']
      delete engine.StateSetters[bankId+'r']
    }
  }, [bankId])

  // Handles click event to switch to this bank
  const switchToSlot = () => {
    engine.consumeBank(bankId)
  }

  // Returns the current bank label
  const giveLabel = () => { return engine.banks[slotAddress] }

  return <div
    className={(isActive?'bt-slot-active ':'' + 'bt-slot') +' text-center ' + (green&&'glow-green') }
    id={bankId}
    onClick={switchToSlot}
    style={{width: '12.5%', height: 34, fontSize: "110%", fontWeight: "bold", position: 'relative'}}
  >
    <div style={{
      position: 'absolute',
      width: '100%',
      left: '50%',
      top: '50%',
      transform: `translate(-50%, -50%) scale(${engine.labelZoom()*1.2})`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'center'
    }}>
      {giveLabel()}
    </div>
    <Tooltip id={'FB'} payload={''} width='100%' height='34px' position='absolute' />  
  </div>
}

/**
 * Renders a user bank slot in the bank table with editable name
 * @param {Object} props - Component properties
 * @param {number} props.slotAddress - The address of the bank slot
 * @returns {JSX.Element} The user bank component
 */
function UserBank ({slotAddress}) {
  // Create a unique ID for this bank
  const bankId = 'UBa'+slotAddress
  // Track if this bank is currently active
  const [isActive, setIsActive] = useState(bankId===engine.currentBank?true:false)
  // State for green highlight effect
  const [green, makeGreen] = useState(false)
  // State for showing input field for name editing
  const [inputField, setSaveField] = useState(false)
  // State for forcing component reload
  const [_, makeReload] = useState(0)

  // Register state setters in engine.StateSetters and clean up on unmount
  useEffect(() => {
    engine.StateSetters[bankId] = setIsActive
    engine.StateSetters[bankId+'g'] = makeGreen
    engine.StateSetters[bankId+'A'] = setSaveField
    engine.StateSetters[bankId+'r'] = makeReload
    return () => {
      delete engine.StateSetters[bankId]
      delete engine.StateSetters[bankId+'g']
      delete engine.StateSetters[bankId+'A']
      delete engine.StateSetters[bankId+'r']
    }
  }, [bankId])

  // Update global state based on input field visibility
  useEffect(() => {
    engine.isBankNameChange = !!inputField
    // No cleanup needed here
  }, [inputField])

  /**
   * Handles click event to switch to this bank if not in name change mode
   */
  const switchToSlot = () => {
    !engine.isBankNameChange&&engine.consumeBank(bankId)
  }

  /**
   * Handles mouse/touch down event for long press detection
   */
  const handleDown = () => {
    engine.oldBank!==bankId&&engine.StateSetters[engine.oldBank+'A']&&engine.StateSetters[engine.oldBank+'A'](false)
    engine.holdThenExecute('SBN', bankId+'A', 1000)
  }
  
  /**
   * Handles mouse/touch up event to cancel long press
   */
  const handleUp = () => {
    engine.stopTrackingHeldKey()
  }

  /**
   * Returns the current bank label
   * @returns {string} The bank label
   */
  const giveLabel = () => { return engine.banks[slotAddress+2]}

  // Create input form for name editing
  const form = <InputForm
    formId="userBankForm"
    inputFieldClass="input-form"
    addressId={bankId}
    labelFoo={giveLabel}
    setSaveField={setSaveField}
    maxLength={30}
  />
  let prev_name = giveLabel()

  return <div
  className={(isActive?'bt-slot-active ':'' + 'bt-slot') +' text-center ' + (green&&'glow-green')}
    id={bankId}
    onClick={switchToSlot}
  onMouseDown={handleDown} 
  onMouseUp={handleUp}
  onTouchStart={handleDown} 
  onTouchEnd={handleUp}
  onChange={e => {
    e.target.value?
      engine.changePresetOrBankName(slotAddress, e.target.value, false)
      :engine.changePresetOrBankName(slotAddress, prev_name, false)
    }
  }
  style={{width: '12.5%', height: 34, fontSize: "110%", fontWeight: "bold", 
    position: 'relative', 
  }}>
    <div 
    style={{
      position: 'absolute',
      width: '100%',
      left: '50%',
      top: '50%',
      transform: `translate(-50%, -50%) scale(${engine.labelZoom()*1.2})`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'center'
    }}>
    {!inputField&&giveLabel()}
    {inputField&&form}
    </div>
    {!inputField && (
      <Tooltip id={'UB'} payload={''} width='100%' height='34px' position='absolute' />
    )}
  </div>
}

/**
 * Renders a preset slot in the bank table with editable name
 * @param {Object} props - Component properties
 * @param {number} props.slotAddress - The address of the preset slot
 * @returns {JSX.Element} The preset component
 */
function Preset ({slotAddress}) {
  // Create a unique ID for this preset
  const presetId = 'PRa'+slotAddress
  // Track if this preset is currently active
  const [isActive, setIsActive] = useState(presetId===engine.currentPreset?true:false)
  // State for showing input field for name editing
  const [inputField, setSaveField] = useState(false)
  // State for forcing component reload
  const [_, makeReload] = useState(0)
  // State for copy mark
  const [copyMark, setCopyMark] = useState(false)

  // Register state setters in engine.StateSetters and clean up on unmount
  useEffect(() => {
    engine.StateSetters[presetId] = setIsActive
    engine.StateSetters[presetId+'A'] = setSaveField
    engine.StateSetters[presetId+'r'] = makeReload
    engine.StateSetters[presetId+'cm'] = setCopyMark
    return () => {
      delete engine.StateSetters[presetId]
      delete engine.StateSetters[presetId+'A']
      delete engine.StateSetters[presetId+'r']
      delete engine.StateSetters[presetId+'cm']
    }
  }, [presetId])

  // Update global state based on input field visibility
  useEffect(() => {
    engine.isPresetNameChange = !!inputField
    // No cleanup needed here
  }, [inputField])

  // Get the preset slot based on current bank and slot address
  const presetSlot = engine.presetSlotByBank(
    engine.currentBank, slotAddress
  )
  /**
   * Handles click event to switch to this preset if not in name change mode
   */
  const switchToSlot = () => {
    !engine.isPresetNameChange&&engine.consumePreset(presetId, presetSlot) // experimental
  }
  /**
   * Handles mouse/touch down event for long press detection
   */
  const handleDown = () => {
    engine.previousPresetId!==presetId&&engine.StateSetters[engine.previousPresetId+'A']&&engine.StateSetters[engine.previousPresetId+'A'](false)
    !engine.isCurrentBankFactory()&&engine.holdThenExecute('SPN', presetId+'A', 1000)
    engine.previousPresetId = presetId
  }
  /**
   * Handles mouse/touch up event to cancel long press
   */
  const handleUp = () => {
    engine.stopTrackingHeldKey()
  }
  /**
   * Returns the current preset label
   * @returns {string} The preset label
   */
  const giveLabel = () => {
    let label = engine.PRESETS[presetSlot][
      engine.PRESETS[presetSlot].length - 1
    ]
    return label.slice()
  }
  // Create input form for name editing
  const form = <InputForm
    formId="presetForm"
    inputFieldClass="input-form"
    addressId={presetId}
    labelFoo={giveLabel}
    setSaveField={setSaveField}
  />
  let prev_name = giveLabel()
  const id = 'P'+slotAddress
  return <div
    className={(isActive?'bt-slot-active ':'' + 'bt-slot') +' text-center '}
    id={id}
    onClick={switchToSlot}
    onMouseDown={handleDown} 
    onMouseUp={handleUp}
    onTouchStart={handleDown}
    onTouchEnd={handleUp}
    onChange={e => {
        if (e.target.value) {
          engine.changePresetOrBankName(presetSlot, e.target.value, true, makeReload)
        } else {
          engine.changePresetOrBankName(presetSlot, prev_name, true, makeReload)
        }
      }
    }
    style={{width: '12.5%', height: 34, 
      background: copyMark?'radial-gradient( rgba(49, 238, 255, 0.62) 1%, #9198e50f)':'',
      fontSize: "120%",
      willChange: 'transform', position: 'relative'
    }}>
    <div style={{
      position: 'absolute',
      width: '100%',
      left: '50%',
      top: '50%',
      transform: `translate(-50%, -50%) scale(${engine.labelZoom()*1.2})`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'center'
    }}>
      {!inputField&&giveLabel()}
      {inputField&&form}
    </div>
      {!inputField && (
        <Tooltip id={'Pr'} payload={''} width='100%' height='34px' position='absolute' />
      )}
      
  </div>
}

/**
 * Renders an input form for editing bank or preset names
 * @param {Object} props - Component properties
 * @param {string} props.formId - ID for the form element
 * @param {string} props.inputFieldClass - CSS class for the input field
 * @param {string} props.addressId - ID of the bank or preset being edited
 * @param {Function} props.labelFoo - Function that returns the current label
 * @param {Function} props.setSaveField - State setter for toggling input field visibility
 * @returns {JSX.Element} The input form component
 */
function InputForm ({
  formId, inputFieldClass, addressId, labelFoo, setSaveField,
}) {
 
  return <form
  id={formId}
  autoComplete="off"
  onMouseEnter={e => {engine.clearInputFormLeave(addressId+'A')}}
  onMouseLeave={e => {engine.handleInputFormLeave(addressId+'A')}}
  onTouchStart={e => {engine.clearInputFormLeave(addressId+'A')}}
  onTouchEnd={e => {engine.handleInputFormLeave(addressId+'A')}}
  onSubmit={(e) => {
    let x = document.getElementById(formId)
    x.hidden = true
    setSaveField(false)
    e.preventDefault();
  }}
  >
    <div>
      {/* <label for="uname">Choose a username: </label> */}
      <input 
        className={inputFieldClass}
        type="text" 
        id={addressId+'A'} 
        name="name" required
        placeholder={labelFoo()}
        maxLength={30}
        autoComplete='off'
        />
    </div>
  </form>
}

/**
 * Renders a strip of bank slots
 * @param {Object} props - Component properties
 * @param {number} props.from - Starting index for the bank strip
 * @param {number} props.to - Ending index for the bank strip
 * @param {Function} props.Bank - Component to use for rendering each bank slot
 * @returns {Array<JSX.Element>} Array of bank components
 */
function BankStrip ({from, to, Bank=FactoryBank}) {
  let list = []
  for (let i=from; i<to; i++) {
    list.push(<Bank key={i} slotAddress={i}/>)
  }
  return list
}

/**
 * Renders the bank table that appears on hover
 * Displays available banks and presets in a grid layout
 * @returns {JSX.Element|null} The bank table component or null if not visible
 */
function BankHover () {
  // Create strips for factory and user banks
  let factoryBankStrip = <BankStrip key='fbs' from={0} to={2}/>
  let userBankStrip = <BankStrip key='ubs' from={0} to={6} Bank={UserBank}/> 

  // Create strips for presets (dependent on the selected bank)
  let presetStrip1 = <BankStrip from={0} to={8} Bank={Preset}/>
  let presetStrip2 = <BankStrip from={8} to={16} Bank={Preset}/>

  // State for forcing a reload of the table
  const [reload, makeReload] = useState(false)
  engine.StateSetters['BankTABLEreload'] = makeReload

  // Define the bank table component
  let BankTable = <div 
    id='BT'
    className='f-col qt-table'
    style = {{
      width: 1281,
      height: 100,
      // backgroundColor: 'rgb(51, 51, 51)', opacity: 0.82,
      // color: 'orange',

      position: 'absolute',
      top: 491.5, 
      left: 116.5,
      zIndex: 2,
      backgroundColor: engine.fixedBackgroundColor,
      backgroundImage: engine.BQTConicGradient,
    }}
    > 
      <div className='f-row'>{[factoryBankStrip, userBankStrip]}</div>
      <div className='f-row'>{presetStrip1}</div>
      <div className='f-row'>{presetStrip2}</div>
    </div>

  // State for controlling visibility of the bank table
  const [hoverOn, setBankTableOn] = useState(false)
  engine.StateSetters['setBankTableOn'] = setBankTableOn
  
  // Effect to handle changes in visibility
  useEffect(() => {
  }, [hoverOn, reload])

  // Only render the table when hoverOn is true
  return hoverOn&&BankTable
}

/**
 * Renders a global mute or solo button
 * @param {Object} props - Component properties
 * @param {string} props.elementId - ID for the button element
 * @param {string} props.label - Text label for the button
 * @returns {JSX.Element} The mute/solo button component
 */
function MuteSoloKeyGlobal ({elementId, label}) {
  // Track button state
  const [isClicked, setIsClicked] = useState(false)

  /**
   * Determines the CSS class based on button type (mute or solo)
   * @returns {string} CSS class name
   */
  const activeColor = () => {
    return elementId[2]==='M'?'mute-active':'solo-active'
  } 

  /**
   * Handles click event to toggle mute or solo state
   */
  const handleClick = () => {
    setIsClicked(state => !state)
    if (elementId[2]==='M') {
      engine.setMuteALLorNot()
      return
    }
    engine.setSoloALLorNot()
  }
  const muteKey = (
    <button
    id={elementId}
    className={' transform ' + 'butt-scaleUp-lil ' + 'box_ ' + activeColor() + ' text-center'}
    onClick={handleClick}
    style={style(['28px','28px',], {
      // fontSize: '90%',
      color: 'black', boxShadow: boxShadow})}
    >
      <span
      style={{transform: `scale(${engine.labelZoom()})`}}
      >
         {label}
      </span>
    </button>
  )
  return <Tooltip id={elementId} payload={muteKey}></Tooltip>
}
/**
 * Renders a pair of global mute and solo buttons
 * @param {Object} props - Component properties
 * @param {string} props.e1 - ID for the mute button element
 * @param {string} props.e2 - ID for the solo button element
 * @param {string} [props.label1='—'] - Text label for the mute button
 * @param {string} [props.label2='|'] - Text label for the solo button
 * @returns {JSX.Element} A fragment containing a pair of global mute/solo buttons with padding
 */
function InstMuteSoloPairGlobal ({e1, e2, label1='—', label2='|'}) {
  return <>
  <MuteSoloKeyGlobal elementId={e1} label={label1}/>
  <Pad params={['32px', '28px', 'yellow', '1']}/>
  <MuteSoloKeyGlobal elementId={e2} label={label2}/>
  </>
}

/**
 * Renders an individual mute or solo button for a specific instrument
 * @param {Object} props - Component properties
 * @param {string} props.elementId - ID for the button element (format: 'IxM' for mute, 'IxS' for solo)
 * @param {string} props.color - Background color/gradient for the active button state
 * @param {string} props.label - Text label for the button
 * @returns {JSX.Element} The instrument-specific mute/solo button component
 */
function MuteSoloKey ({elementId, color, label}) {
  const [isClicked, setIsClicked] = useState(false)

  /**
   * Handles click event to toggle mute or solo state for a specific instrument
   */
  const handleClick = () => {
    setIsClicked(state => !state)
    if (engine.isMuteSoloKeyInverted()) {
      return
    }
    
    if (elementId[2]==='M') {
      engine.setMuteBit(elementId[1])
      return
    }
    engine.setSoloBit(elementId[1])
  }

  const muteKey = (
    <button
    id={elementId}
    className={' transform ' + 'butt-scaleUp-lil ' + 'box_ ' + 'text-center'}
    style={style(['28px','28px',], {
      fontSize: '90%', color: 'black',
      background: isClicked?color:'radial-gradient(grey 50%, #9198e50f)', boxShadow: boxShadow,
      opacity: isClicked?'0.8':'0.38',
    })}
    onClick={handleClick}
    >
      <span style={{transform: `scale(${engine.labelZoom()})`}}>
      {label}
      </span>
    </button>
  )
  return <Tooltip id={elementId} payload={muteKey}></Tooltip>
}

/**
 * Renders a pair of mute and solo buttons for a specific instrument
 * @param {Object} props - Component properties
 * @param {string} props.e1 - ID for the mute button element
 * @param {string} props.e2 - ID for the solo button element
 * @param {string} [props.label1='—'] - Text label for the mute button
 * @param {string} [props.label2='|'] - Text label for the solo button
 * @returns {JSX.Element} A fragment containing a pair of instrument-specific mute/solo buttons with padding
 */
function InstMuteSoloPair ({e1, e2, label1='—', label2='|'}) {
  return <>
  <MuteSoloKey elementId={e1} color={'radial-gradient(salmon 50%, #9198e50f)'} label={label1}/>
  <Pad params={['45px', '28px', 'yellow', '1']}/>
  <MuteSoloKey elementId={e2} color={'radial-gradient(rgb(30, 236, 254) 50%, #9198e50f)'} label={label2}/>
  </>
}

/**
 * Renders the complete mute/solo control strip containing buttons for all instruments
 * @returns {JSX.Element} The mute/solo control strip component
 */
function MuteSoloStrip () {
  // State for forcing re-render when needed
  const [_, makeReload] = useState(0)
  engine.StateSetters['mskg-r'] = makeReload
  
  return <div
  style={style(['100%', '40px', 'black', '0.4'])}>
    <Pad params={['100%', '6px', 'red', '0.4']}/>
    <div
    className='f-row '
    style={style(['100%', '28px', 'green', '0.4'])}>
      <Pad params={['20px', '28px', 'yellow', '1']}/>

      {/* Global mute/solo controls */}
      <InstMuteSoloPairGlobal e1={'I8M'} e2={'I8S'} label1={'—|'} label2={'||'}/>

      <Pad params={['46px', '28px', 'yellow', '1']}/>
      {/* Individual instrument mute/solo controls */}
      <InstMuteSoloPair e1={'I7M'} e2={'I7S'}/>

      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I6M'} e2={'I6S'}/>
      
      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I5M'} e2={'I5S'}/>

      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I4M'} e2={'I4S'}/>

      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I3M'} e2={'I3S'}/>

      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I2M'} e2={'I2S'}/>

      <Pad params={['57px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I1M'} e2={'I1S'}/>

      <Pad params={['60px', '28px', 'yellow', '1']}/>
      <InstMuteSoloPair e1={'I0M'} e2={'I0S'}/>

    </div>
    
  </div>
}

/**
 * AlertHover component displays modal alerts with customizable messages and action buttons.
 * It provides a consistent UI for system alerts, confirmations, and notifications.
 * 
 * @returns {JSX.Element|null} The alert overlay or null if no alert is active
 */
function AlertHover () {
  /**
   * Button component for alert actions (OK/CANCEL)
   * 
   * @param {Object} props - Component properties
   * @param {string} props.label - Button text
   * @param {Function} props.callback - Function to execute on button click
   * @returns {JSX.Element} A styled button element
   */
  function OKCancelButton ({label="", callback=()=>{}}) {
    return <button
    className='bt-slot monospace'
    style={{
      width: "100px",
      fontWeight: "bolder",
      fontSize: "140%", transform: "none", boxShadow: "none", filter: "none"
    }}
    onClick={() => {
      callback()
      engine.isOngoingAlert = false
    }}
    >{label}</button>
  }
  
  /**
   * Renders the alert dialog with message and action buttons
   * 
   * @param {Object} props - Component properties
   * @param {Array} props.message - Array containing [messageText, okCallback, cancelCallback, additionalContent]
   * @returns {JSX.Element} The complete alert dialog
   */
  function AlertTable ({message=["", ()=>{}, ()=>{}, []]}) {
    // Split message to separate OK button label from alert text
    let OKLabel_alertText = message[0].split('@')
    
    // Create alert message component
    let alert = <div
    className='bt-slot monospace'
    style={{
      fontSize: "140%", transform: "none", boxShadow: "none", fontWeight: "bolder",
    }}
    >{OKLabel_alertText[1]}{message[3]}</div>
    
    // Create action buttons if callbacks are provided
    let OK = message[1] ? <OKCancelButton label={OKLabel_alertText[0]} callback={message[1]}/> : ""
    let Cancel = message[2] ? <OKCancelButton label='CANCEL' callback={message[2]}/> : ""
    
    // Set global alert state
    engine.isOngoingAlert = alert ? true : false

    // Container for buttons
    let Buttons = <div>
      {Cancel}{OK}
    </div>

    return <div 
    id='AT'
    className='f-col qt-table text-center'
    style = {{
      width: 1281,
      height: 100,
      position: 'absolute',
      top: 491.5, 
      left: 116.5,
      zIndex: 2,
      backgroundColor: engine.fixedBackgroundColor,
      backgroundImage: engine.BQTConicGradient,
      lineHeight: "40px"
    }}
    > 
    {alert}
    {Buttons}
    </div>
  } 

  // State to control alert visibility and content
  const [message, setAlertTableOn] = useState(["", ()=>{}, ()=>{}, []])
  engine.StateSetters['setAlertTableOn'] = setAlertTableOn
  
  // Only render alert when message exists
  return message[0] && <AlertTable message={message}/>
}


/**
 * HueBar component for controlling the color theme of the application
 * @returns {JSX.Element} The HueBar component
 */
function HueBar() {
  // Get preset CSS styles for different elements
  const [btSlotCSS, _1] = useState(engine.getPresetSlotCSS('.bt-slot'))
  const [qtSlotCSS, _2] = useState(engine.getPresetSlotCSS('.qt-slot'))
  const [instLabelCSS, _3] = useState(engine.getPresetSlotCSS('.text-orange-color'))
  
  // Initialize color handling on component mount
  useEffect(() => {
    handleColor()
  }, [])

  // State to track scrolling behavior
  const [scrolling, setIsScrolling] = useState(false)
  
  // Prevent default wheel behavior when scrolling the HueBar
  useEffect(() => {
    if (scrolling) {
      const element = document.getElementById("HueBar");
      element.addEventListener('wheel', (event) => {
        event.preventDefault() })
      return () => {
        element.removeEventListener('wheel', () => {});
      }
    }
  }, [scrolling]);

  /**
   * Handle mouse wheel events on the HueBar
   * @param {WheelEvent} e - The wheel event
   */
  const handleWheel = (e) => {
    setIsScrolling(true)
    const input = document.querySelector("#colorHandle");
    const deltaY = e.deltaY;

    if (deltaY < 0) {
      // += 1 resets the value to its maxRange; probably a bug
      input.value *= 1.009;
    } else {
      input.value -= 1;
    }
    handleColor()
  }
  
  /**
   * Update the color theme based on the current slider value
   * Calculates HSL values and updates various UI elements
   */
  const handleColor = () => {
    const input = document.querySelector("#colorHandle");
    let hue = input.value
    let x = hue>220?3.3+0.01*hue:3.3
    let sat = Math.abs(Math.cos(0.01*hue))*100/(62-(hue-41)/x) 
    let lum = Math.abs(Math.cos(0.01*hue))*100
    let bodyHSL = `hsl(
      ${hue*sat/0.3678794412}, 
      ${sat}%, 
      ${lum}%)`

    // Update body background and store current color values
    document.body.style.backgroundColor = bodyHSL
    engine.currentBodyColor = bodyHSL
    engine.hueRangeVar = hue
    
    // Calculate gradient transition using a linear equation
    const y = -0.081818*hue+66.45454
    engine.fixedBackgroundColor2 = `hsl(0, 0%, ${y}%)`
    engine.BQTConicGradient = `conic-gradient(from 0.83turn at 42% 290%,
    ${engine.fixedBackgroundColor2} 0%,
    rgba(90, 85, 96, 0) 19%, 
    ${engine.fixedBackgroundColor2} 33%)`

    // Apply gradient to tables if they exist
    let QT = engine.isQueueTable&&document.getElementById('QT')
    let BT = engine.isBankTable&&document.getElementById('BT')
    let AT = engine.isOngoingAlert&&document.getElementById('AT')

    if (QT) {
      QT.style.backgroundImage = engine.BQTConicGradient
    }
    if (BT) {
      BT.style.backgroundImage = engine.BQTConicGradient
    }
    if (AT) {
      AT.style.backgroundImage = engine.BQTConicGradient
    }

    // Calculate and set font color based on luminance
    let font_lum = lum+85
    engine.currentFontColor = `hsl(19, 100%, ${font_lum}%)`
    btSlotCSS.style.setProperty('color', engine.currentFontColor )
    instLabelCSS.style.setProperty('color', engine.currentFontColor)
    qtSlotCSS.style.setProperty('color', engine.currentFontColor)
  } 
  
  // Register the color handler with the engine
  engine.StateSetters['handleColor'] = handleColor

  // Create the slider input element
  const slider = 
    <input 
    // className='range-slider-handle2 '
    style={{width: "100%", background: "none", outline: "none"}}
    type="range" id="colorHandle"
    min={engine.hueRangeMin} max={engine.hueRangeMax} defaultValue={engine.hueRangeVar}/>
  
  // Track click state for drag operations
  const [isClicked, setIsClicked] = useState(false)
  const hueBar = <div
  id='HueBar'
	className='hue-bar'
  onMouseMove={() => {isClicked&&handleColor()}}
  onTouchMove={() => {isClicked&&handleColor()}}
  onClick={() => {isClicked&&handleColor(), setIsClicked(false)}}
  onTouchEnd={() => {setIsScrolling(false)}}
  onMouseDown={() => {setIsClicked(true), handleColor()}}
  onTouchStart={() => {setIsClicked(true), handleColor()}} // maybe not needed
  onMouseLeave={() => {setIsClicked(false)}}
  onWheel={handleWheel}
  style={{
    backgroundImage: engine.linearGradient
  }}
	>{slider} <HelpBar/>
	</div>

	return <Tooltip id={'HueBar'} payload={hueBar}></Tooltip>
}


/**
 * Layout component that wraps children in a table structure
 * @param {Object} props - Component properties
 * @param {ReactNode} props.children - Child components to render inside the layout
 * @returns {JSX.Element} The Layout component
 */
function Layout({children}) {
  return <div
  id='Layout'
  className='table transform'>
    {children}
  </div>
}

/**
   * GitHub logo component with link
   * @returns {JSX.Element} The GitHub link component
   */
function TheGitHubCat ({sizeFactor=1}) {
  const theCatItself = <div
  style={{margin: '10px'}}> 
    <a href="https://github.com/sonicarchetype/TR909" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center' }}>
      <img src={githubLogo} alt="GitHub" width={24*sizeFactor} height={24*sizeFactor} style={{ marginRight: '5px'}} />
    </a>
  </div>

  return theCatItself
}

/**
 * InfoBar component displaying application information and links
 * @param {Object} props - Component properties
 * @param {string} props.width - Width of the InfoBar
 * @param {number} props.height - Height of the InfoBar
 * @returns {JSX.Element} The InfoBar component
 */
function InfoBar ({width='100%', height=20}) {  
  /**
   * Application title component
   * @returns {JSX.Element} The title component
   */
  function Info () {
    return <div
    className='f-col monospace'
    style={{
      width: 'auto', 
      height: '100%', 
      color: 'white',
      fontSize: '90%',
      margin: '10px', marginLeft: '245px',
      marginTop: '13px',
      // fontWeight: 'bold',
    }}
    > 
    <span id='info-bar-title' style={{ 
      background: 'rgba(84, 83, 83, 0.62)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
      letterSpacing: '26px'
    }}>
      SONIC ARCHETYPE REIMAGINED
    </span>
    </div>
  }
  return <div
  className='f-row monospace'
  style={{
    width: width, height: height, 
    // backgroundColor: 'grey',
    fontSize: '150%',
    justifyContent: 'space-between',
  }}
  >
    <Tooltip id={'Info'} payload={<Info/>}/>
    <Tooltip id={'GH'} payload={<TheGitHubCat/>}/>
  </div>
}

/**
 * Credits component displaying a list of contributors with links
 * @returns {JSX.Element} The credits component
 */
function DCredits() {
  const credits = [
    { name: "VINCENT RIEMER", link: "https://vincentriemer.com/" },
    { name: "REACT", link: "https://reactjs.org" },
    { name: "DOCTORMIX", link: "https://youtube.com/@doctormix" },
    { name: "JASON BAKER", link: "mailto:bake0028@gold.tc.umn.edu" },
  ];

  const list = []
  for (let i = 0; i < credits.length; i++) {
    const isMailto = credits[i].link.startsWith('mailto:');
    list.push(
      <a 
        key={i} 
        href={credits[i].link} 
        target={isMailto ? undefined : "_blank"}
        rel={isMailto ? undefined : "noopener noreferrer"}
        style={{ color: 'white' }}
      >
        {credits[i].name}
      </a>
    )
    list.push(<span key={i+credits.length} style={{ margin: '0 6px' }}>•</span>)
  }
  list.pop()

  return (
    <>
      {list}
    </>
  );
}

/**
 * StatusBar component displaying application status and controls
 * @returns {JSX.Element} The StatusBar component
 */
function StatusBar () {
  /**
   * Toggle the bank table display
   */
  const openBankTable = () => {
    let workaround = setTimeout(() => {
      if (engine.isBankTable&&engine.isQueueTable) {
        engine.isQueueTable = !engine.isQueueTable
        engine.StateSetters['setQueueTableOn'](engine.isQueueTable)
        engine.StateSetters['LAST STEP-reload'](state => !state)
        engine.StateSetters['sbPreset-r'](false)
      }

      clearTimeout(workaround)
    }, 10)
    // ----------------------
    engine.isBankTable = !engine.isBankTable
    engine.StateSetters['setBankTableOn'](engine.isBankTable)
    engine.isReloaded = false
    engine.setCOPY_TO_false()
    engine.resetMAIN_KEYS_MESSAGE()

    if (engine.currentBank !== engine.oldBank) {
      engine.consumeBank(engine.oldBank)
    }
    
    let btSlotCSS = engine.getPresetSlotCSS('.bt-slot')
    let instLabelCSS = engine.getPresetSlotCSS('.text-orange-color')
    btSlotCSS.style.setProperty('color', engine.currentFontColor)
    instLabelCSS.style.setProperty('color', engine.currentFontColor)
    engine.setEditKeysStatus()
    engine.StateSetters['sbBank-r'](engine.isBankTable)
    engine.StateSetters['DControlVariable-r'](state => state+1)
    engine.StateSetters['SCALE-reload'](state => !state)
    
  }
  
  /**
   * Toggle the preset table display
   */
  const openPresetTable = () => {
    if (!engine.isOngoingAlert) {
      engine.isBankTable&&document.getElementById('sbBank').click()
      engine.isQueueTable = !engine.isQueueTable
      engine.StateSetters['setQueueTableOn'](engine.isQueueTable)
      engine.StateSetters['sbPreset-r'](engine.isQueueTable)

      engine.setCOPY_TO_false()
      engine.resetMAIN_KEYS_MESSAGE()

      // make LAST STEP reload
      engine.StateSetters['LAST STEP-reload'](state => !state)
      engine.setEditKeysStatus()
      engine.StateSetters['DControlVariable-r'](state => state+1)
      engine.StateSetters['SCALE-reload'](state => !state)
    }
  }

  /**
   * Folder component for status bar items
   * @param {Object} props - Component properties
   * @param {string} props.id - ID for the folder
   * @param {string|ReactNode} props.info - Information to display
   * @param {Function} props.backgroundColor - Function returning background color
   * @param {Function} props.onClick - Click handler
   * @param {string} props.pointerEvents - CSS pointer-events value
   * @param {string} props.width - Width of the folder
   * @param {string} props.cursor - CSS cursor value
   * @param {string} props.alignSelf - CSS align-self value
   * @returns {JSX.Element} The folder component
   */
  function Folder ({id= "", info="", 
    backgroundColor=()=>{}, onClick=()=>{},
    pointerEvents='auto', width="", // maybe no wrap instead?
    cursor='default', alignSelf='', 
    transform='',
  }) {
    const [data, setData] = useState("")
    const [_, reload] = useState(false)
    engine.StateSetters[id] = setData
    engine.StateSetters[id+'-r'] = reload

    return <div
    id={id}
    className='status-bar-folder'
    onClick={onClick}
    style={{
      width: width?width:'',
      display: 'flex',
      alignItems: 'center',
      // justifySelf: 'end',
      background: backgroundColor(),
      paddingLeft: '10px', paddingRight: '10px',
      pointerEvents: pointerEvents, cursor: cursor,
      alignSelf: alignSelf,
      transform: transform,
    }}
    >
      <Tooltip id={id} payload={data?data:info}></Tooltip>
    </div>
  }

  /**
   * Component to display the application version
   * @returns {JSX.Element} The version component
   */
  function DVersion() {
    const [version, setVersion] = useState("v1.0");
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [isDevMode, setIsDevMode] = useState(false);
    
    useEffect(() => {
      const updateVersionDisplay = (hasUpdate) => {
        setUpdateAvailable(hasUpdate);
        if (versionService.currentVersion) {
          setVersion(`v${versionService.currentVersion}`);
        }
        setIsDevMode(versionService.isDevelopment);
      };
      
      // Initial check
      versionService.checkForUpdates(updateVersionDisplay);
      
      // Set up periodic checking only in production
      if (!versionService.isDevelopment) {
        const intervalId = setInterval(() => {
          versionService.checkForUpdates(updateVersionDisplay);
        }, 30 * 60 * 1000); // Check every 30 minutes
        
        return () => clearInterval(intervalId);
      }
    }, []);
    
    return (
      <div style={{ 
        color: isDevMode 
          ? 'rgba(255, 255, 0, 0.8)' // Yellow for dev mode
          : updateAvailable 
            ? 'rgb(30, 236, 254)' // Cyan for update available
            : 'white' // Default color
      }}>
        {isDevMode ? `DEV ${version}` : version}
      </div>
    );
  }

  const barBackground = ''

  /**
   * DHelp component that toggles the help feature in the application.
   * @returns {JSX.Element} The DHelp component
   */
  function DHelp() {
    // State to track whether help is currently enabled or not
    const [help, setHelp] = useState(true);

    // Function to handle click events on the help button
    const onClick = () => {
      // Toggle the help state in the engine
      engine.HELP = !engine.HELP;
      // Update the local state to reflect the new help status
      setHelp(engine.HELP);
    };

    return (
      <div 
        onClick={onClick} 
        onMouseEnter={() => engine.StateSetters['setHelpTextId']('sbHelp')}
        onMouseLeave={() => engine.StateSetters['setHelpTextId']('noHelp')}
        style={{
          borderBottom: help ? '2px solid rgb(30, 236, 254)' : 'none', 
          color: help ? 'rgb(30, 236, 254)' : 'white'
        }}
      >
        HELP
      </div>
    );
  }

  const navigate = useNavigate();

  return <div
  className='monospace'
  style={{
    width: '100%', height: '24px', 
    backgroundColor: barBackground,
    fontSize: '120%', fontWeight: 'bold', color: 'white',
    display: 'flex',
    boxShadow: '0px 5px 15px rgba(128, 128, 128, 0.8)',
  }}
  >
  {/* Folder for displaying the unit name */}
  <Folder id={'sbName'} info='.tr909'
    backgroundColor={() => {return barBackground}}
    transform='none'
  />

  {/* Folder for main keys control variable */}
  <Folder id={'sbGLCV'} info={<>MAIN KEYS:&nbsp;<DControlVariable/></>} width={300}
  transform='none'
  />

  {/* Folder for user bank name with dynamic background color based on bank table state */}
  <Folder id={'sbBank'} info={engine.getUserBankName()} 
    backgroundColor={() => {
      let opacity = engine.isBankTable?0.8:0.2
      return `rgba(68, 72, 84, ${opacity})`
    }} 
    onClick={()=>{!engine.isOngoingAlert&&openBankTable()}}
    pointerEvents='all' cursor='pointer'
  />

  {/* Folder for preset selection with dynamic background color based on queue table state */}
  <Folder id={'sbPreset'} backgroundColor={() => {
      let opacity = engine.isQueueTable?0.8:0.2
      return `rgba(68, 72, 84, ${opacity})`
    }} 
    onClick={openPresetTable}
    pointerEvents='all' cursor='pointer'
  />

  {/* Folder for displaying preset information */}
  <Folder id={'sbPresetInfo'}
    transform='none'
    info={<div><DPlaybackQueue/>:<DLastPatAddToQueue/>:<DSelectedQTSlot/></div>}
  />

  {/* Folder for scale display */}
  <Folder id={'sbScale'} info={<div><DScale/></div>} width='auto'
  transform='none'
  />

  {/* Folder for displaying selected instrument */}
  <Folder id={'sbInst'} info={<><DSelectedInst/></>} width={40}
  transform='none'
  />

  {/* Folder for cycle information display */}
  <Folder id={'sbCycle'}
    transform='none'
    info={<div style={{fontSize: '140%'}}><DInfinity/></div>}
  />

  <div style={{flexGrow: 1}}></div>

  {/* Folder for rendering action */}
  <Folder id={'sbRender'}
    info={<>RENDER</>} 
    width={48} 
    cursor='pointer'
    pointerEvents='all'
    onClick={async () => {!engine.isOngoingAlert&&engine.Alert(
     [ `OK @RENDER | ${engine.getCurrentPresetName()} | TO AUDIO ?`,
      async (OK) => {await engine.renderMachine(); engine.Alert()},
    (CANCEL) => engine.Alert()]
    )}}
  />

  {/* Folder for help feature */}
  <Folder id={'sbHelp'} info={<DHelp/>} width='auto'
  cursor='pointer'
  pointerEvents='all'
  />

  {/* Folder for displaying manual page */}
  <Folder id={'sbManual'} info={<div 
  onMouseEnter={() => engine.StateSetters['setHelpTextId']('sbManual')}
  onMouseLeave={() => engine.StateSetters['setHelpTextId']('noHelp')}
  >MANUAL</div>} width='auto' 
  cursor='pointer'
  pointerEvents='all'
  // onClick={() => navigate('/manual')}
  />

  {/* Folder for credits display with alert on click */}
  <Folder id={'sbCredits'} info={<div>~(^ :: ^-)~</div>} width='auto'
  cursor='pointer'
  pointerEvents='all'
  onClick={() => {!engine.isOngoingAlert&&engine.Alert(
   [ `... @WE GIVE SPECIAL THANKS AND HUGS TO `,
    (OK) => {engine.Alert()}, false, <DCredits />]
  )}}
  />

  {/* Folder for displaying version information */}
  <Folder id={'sbVersion'} info={<DVersion/>} width='auto' 
  transform='none'/>

  </div>
}

import ReactMarkdown from 'react-markdown';

/**
 * PageComponent fetches and displays the content of a markdown file.
 * @returns {JSX.Element} The rendered component containing the markdown content.
 */
// const PageComponent = () => {
//     const [content, setContent] = useState("");

//     useEffect(() => {
//         fetch("can-be-manual.md")
//             .then((res) => res.text())
//             .then((text) => setContent(text));
//     }, []);

//     return (
//         <div className="post" style={{ textAlign: 'center', margin: '20px' }}>
//             <ReactMarkdown>{content}</ReactMarkdown>
//         </div>
//     );
// };

/**
 * Footer component that displays a footer section with a button to navigate to the manual page. NOT USED
 * @returns {JSX.Element} The Footer component
 */
// function Footer () {
//   return <div>
//   </div>
// }

/**
 * L3 component serves as the outermost container for the application's UI.
 * It provides styling for the main interface and hosts overlay components.
 * 
 * @param {Object} props - Component properties
 * @param {ReactNode} props.children - Child components to render inside L3
 * @returns {JSX.Element} The L3 container component
 */
function L3 ({children}) {
  return <>
  <div id="qwerty" className="skin-container">
    <div id="app-skin" className="skin" style={{ display: 'none' }}>
      <div
        id='L3'
        className='div-L3' 
        style={{
          position: 'relative',
          border: '10px solid rgba(242, 235, 229, 0.18)',
          borderRadius: 5, 
          // display: 'none',
          opacity: 0, // Initially hidden and transparent
        }}
        > 
          <QueueHover />
          <BankHover />
          <AlertHover />
          {children}
      </div>
    </div>
    <Loader />
  </div>
  </>
}

/**
 * L1 component serves as the primary container for the application's UI.
 * It handles zoom level detection and manages event listeners for browser resizing.
 * 
 * @param {Object} props - Component properties
 * @param {ReactNode} props.children - Child components to render inside L1
 * @returns {JSX.Element} The L1 container component
 */
function L1 ({children}) {
  
  useEffect(() => {
    
    /**
     * Handles browser zoom level changes and updates the UI accordingly.
     * Recalculates zoom level based on window dimensions and triggers UI updates.
     */
    function handleZoom () {
      const current_value = (window.outerWidth - 8) / window.innerWidth
      engine.browserZoomLevel = current_value < 0.7
      ? 0.7
      : 0.8

      // Trigger updates for various UI components to adjust to new zoom level
      engine.StateSetters['mskg-r'](state => state + 1)
      engine.StateSetters['ALT-reload'](state => state + 1)
      engine.StateSetters['TS-PM-reload'](state => state + 1)
      engine.StateSetters['Q-reload'](state => state + 1)
      engine.StateSetters['ils-r'](state => state + 1)
      engine.StateSetters['TA-r'](state => state + 1)
      engine.StateSetters['EC'](state => state + 1)
      engine.StateSetters['BankTABLEreload'](state => state + 1)
      engine.StateSetters['TABLEreload'](state => state + 1)
    }
    
    // Assign the zoom handler to the engine and load initial state
    engine.handleLabelZoom = handleZoom
    engine.loadState()
    engine.decodeSoundData()
    // Only add resize listener for Safari desktop browsers
    engine.isSafariDesktop() && window.addEventListener('resize', handleZoom)
    
    // Cleanup event listener on component unmount
    return () => {
      engine.isSafariDesktop() && window.removeEventListener('resize', handleZoom)
    }
  }, [])
  
  return (
    <div
      id='L1'
      className='div-L1'
      tabIndex={0} 
      style={{
        outline: 'none',
        border: debug && '1px solid #001eff'
      }}
    >
      {/* <div className="tech-pattern-background"></div> */}
      {debug && 'L1'}{children}
    </div>
  )
}

/**
 * Tooltip component that displays help text when hovering over UI elements
 * @param {Object} props - Component properties
 * @param {ReactNode} props.payload - Content to display inside the tooltip
 * @param {string} props.id - Unique identifier for the help text
 * @param {string} [props.width] - Optional width of the tooltip container
 * @param {string} [props.height] - Optional height of the tooltip container
 * @returns {JSX.Element} The Tooltip component
 */
function Tooltip({ payload=null, id, width=null, height=null, position='null'}) {
  const style = width && height && {width: width, height: height, position: position}
  if(payload && typeof payload === 'string') {
    payload = payload.length>16?payload.slice(0, 16)+'...':payload
  }
  return (
    <div 
      style={style}
      onMouseEnter={() => engine.HELP && engine.StateSetters['setHelpTextId'](id)}
      onMouseLeave={() => engine.HELP && engine.StateSetters['setHelpTextId']('noHelp')}
    >
      {payload}
    </div>
  );
}

/**
 * HelpBar component that displays contextual help text for UI elements
 * Shows help text when hovering over elements with tooltips
 * @returns {JSX.Element} The HelpBar component
 */
function HelpBar () {
  const [helpTextId, setHelpTextId] = useState('noHelp')
  
  engine.StateSetters['setHelpTextId'] = setHelpTextId
  
  // When helpTextId is 'sbVersion', ensure we have updated version information
  useEffect(() => {
    if (helpTextId === 'sbVersion' && !versionService.isDevelopment) {
      versionService.checkForUpdates();
    }
  }, [helpTextId]);
  
  // Get the help text from helpData
  const helpText = helpData[helpTextId] || 'No help available for this component'
  
  // Add indicator for development mode when showing version help
  const displayText = 
    helpTextId === 'sbVersion' && versionService.isDevelopment
      ? `DEVELOPMENT MODE - ${helpText}`
      : helpText;
  
  return <div className='tooltip monospace'>{displayText.toUpperCase()}</div>
}

/**
 * NameBar component that displays the application logo in a container
 * @returns {JSX.Element} The NameBar component containing the Sonic Archetype logo
 */
function NameBar () {
  const SA_logo = (
    <a href="https://sonicarchetype.com" target="_blank" rel="noopener noreferrer">
      <img
        id='SA-logo' 
        src="/SA-logo-proto.svg" 
        alt="Sonic Archetype Logo"
        style={{
          width: 'auto',
          height: '100%',
          objectFit: 'contain',
          filter: 'brightness(1.2)',
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)'
        }}
      />
    </a>
  )
  return <div id='name-bar-container' style={{
    width: '100%', height: '82px', display: 'flex',
  }}>
    <div className='name-bar' style={{backgroundColor: debug && '#bf00ff38'}}>
      <Tooltip id={'SAL'} payload={SA_logo}/>
    </div>
  </div>
}

/**
 * Main TR909 component that assembles the entire application UI
 * @returns {JSX.Element} The TR909 component
 */
function TR909() {
  engine = initiateEngine(debug)
  
  useEffect(() => {
    // Handle visibility change to fix iOS rendering artifacts
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Force repaint by temporarily adding and removing a class
        document.body.style.display = 'none';
        // Trigger browser reflow
        void document.body.offsetHeight; 
        document.body.style.display = '';
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also handle the page becoming active again via other means
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        // Page was restored from the bfcache
        handleVisibilityChange();
      }
    });
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
    };
  }, []);
  
  return (
  <>
    <SEO 
      title="TR-909 Rhythm Composer (Web Edition)"
      description="Classic TR-909 drum machine emulation for the modern web with authentic sounds and workflow."
      route="/"
    />
    <L1>
      <L3>
        <InfoBar height={45}/>
        <Pad params={['100%', '20px', 'grey', '0.9']}/> 
        <NameBar />
        <Pad params={['100%', '5px', 'grey', '0.9']}/> 
        <Layout>
          <SoundSection />
          <MuteSoloStrip />
          <MidSection />
          <Sequencer />
        </Layout>
        <Pad params={['100%', '5px', 'grey', '0.9']}/> 
        <StatusBar />
        <Pad params={['100%', '5px', 'grey', '0.9']}/>
        <HueBar />
      </L3>
      {/* <Footer /> */}
    </L1>
  </>
  )
}

/**
 * Manual component for displaying help documentation
 * @returns {JSX.Element} The Manual component
 */
function Manual() {
  engine = null
  document.body.style.backgroundColor = localStorage.getItem('currentBodyColor') || 'black'
  return (
    <>
      <SEO 
        title="TR-909 Manual - Rhythm Composer (Web Edition)"
        description="User guide and documentation for the TR-909 web drum machine emulation."
        route="/manual"
      />
      <div className='monospace' style={{ fontSize: '234%', color: 'white', padding: '80px',  }}>{helpData['sbManual']}<br/><br/><TheGitHubCat sizeFactor={2}/></div>
    </>
  )
}

/**
 * Loader component for displaying loading animation
 * @returns {JSX.Element} The Loader component
 */
function Loader() {
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    // Listen for progress updates from the engine
    const handleProgress = (value) => {
      setProgress(Math.floor(value));
    };
    
    // Register the progress handler
    engine.onLoadProgress = handleProgress;
    
    return () => {
      // Clean up
      engine.onLoadProgress = null;
    };
  }, []);

  // Text for the circular animation
  const text = "SONIC ARCHETYPE • TR909 • ";
  const letterCount = text.length;
  
  return (
    <div id="loader" className="loader-container">
      {/* Spinning logo */}
      <div className="logo-spinner">
        <img src="/SA-logo-proto.svg" alt="SA Logo" className="spinning-logo" />
        <div className="text-ring">
          <div className="text-ring-content monospace" style={{ '--n-letters': letterCount }}>
            {text.split('').map((char, i) => (
              <span key={i} style={{ '--i': i }}>
                {char}
              </span>
            ))}
          </div>
        </div>
      </div>
      
      {/* Visual progress bar */}
      <div className="progress-bar-container">
        <div 
          className="progress-bar-fill" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      
      {/* Percentage indicator */}
      <div className="progress-indicator">{progress}%</div>
    </div>
  );
}

/**
 * Main application component that defines routes and handles audio context initialization
 * @returns {JSX.Element} The application component
 */
function App() {
  // Set up key event handlers
  document.onkeydown = function(event) {
    engine && engine.consumePressedKey(event)
  }

  // Save state when page visibility changes
  document.onvisibilitychange = function(event) {
    engine && engine.writeLocalStorage()
    // console.log('visibilitychange', navigator.userAgent)

    if (document.visibilityState === 'hidden') {
      engine.stopPlayback()
      
    } else {
      if (engine) {
        engine.resumePlayback()
        
      }
    }
  }

  // Add iOS audio context initialization helper
  useEffect(() => {
    if (!engine) return;

    // Initialize version checking service
    versionService.checkForUpdates();
    
    // Detect iOS devices
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                 (navigator.userAgentData?.platform === 'iOS' || 
                  (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
    
    if (isIOS) {
      // Create a one-time event listener for the first user interaction
      const initAudio = async () => {
        await engine.ensureAudioContextResumed();
        
        // Remove all event listeners after first interaction
        ['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(event => {
          document.removeEventListener(event, initAudio);
        });
      };
      
      // Add listeners for common user interactions
      ['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(event => {
        document.addEventListener(event, initAudio, { once: true });
      });
      
      // Cleanup on unmount
      return () => {
        ['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(event => {
          document.removeEventListener(event, initAudio);
        });
      };
    }
  }, [engine]);
  
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<TR909 />}/>
        <Route path="manual" element={<Manual/>}/>
      </Routes>
    </BrowserRouter>
  )
}

export default App 