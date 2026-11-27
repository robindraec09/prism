/**
 * `@prismtest/android`: host side of the Android driver. P0-09 spike: adb wrapper, agent launcher
 * and protocol client. The driver interface implementation follows P0-03.
 */
export {
  Adb,
  AGENT_PACKAGE,
  AGENT_RUNNER,
  AGENT_TEST_PACKAGE,
  buildInstrumentArgs,
  DEFAULT_DEVICE_PORT,
  maskSecrets,
  parseDevices,
  parseForwardPort,
  parseReadyLine,
  resolveAdbPath,
  type AdbDevice,
  type AdbOptions,
  type ReadyLine,
} from './adb.js';
export {
  AgentClient,
  TRANSPORT_GRACE_MS,
  type AgentClientOptions,
  type CallStats,
} from './client.js';
export {
  generateToken,
  launchAgent,
  waitForReady,
  type LaunchOptions,
  type RunningAgent,
} from './launcher.js';
export {
  AgentError,
  buildRequest,
  HOST_PROTOCOL,
  parseResponse,
  type ActionResult,
  type CommandRequest,
  type CommandResponse,
  type HelloResult,
  type Idle,
  type ProtocolErrorBody,
  type Rect,
  type Screen,
  type Snapshot,
  type Timing,
  type UiNode,
} from './protocol.js';
export { percentile, summarize, type Summary } from './stats.js';
export { centerOf, findByTestId, walk } from './tree.js';
