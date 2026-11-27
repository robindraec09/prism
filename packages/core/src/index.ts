/**
 * `@prismtest/core`: Prism's unified API, locators, auto-wait, assertions,
 * runner and driver interface.
 *
 * So far this package holds the platform-neutral driver contract (P0-03) that
 * the web, Android, iOS and cloud drivers implement, and the `formatDuration`
 * helper used for timings. See `docs/design/driver-interface.md`.
 *
 * @packageDocumentation
 */

export { formatDuration } from './format-duration.js';

export type { OpenString } from './driver/open-string.js';

export type {
  Insets,
  KnownOrientation,
  Orientation,
  Point,
  Rect,
  Rotation,
  ScreenInfo,
} from './driver/geometry.js';

export {
  KNOWN_PLATFORMS,
  KNOWN_ROLES,
  isKnownRole,
  isWebContext,
  normaliseRole,
} from './driver/tree.js';
export type {
  Ancestor,
  Checked,
  ContextId,
  FindResult,
  Idle,
  KnownPlatform,
  KnownRole,
  MatchedNode,
  NodeFingerprint,
  NodeMatch,
  NodeRef,
  Platform,
  Role,
  Settle,
  UiNode,
  UiNodeBase,
  UiSnapshot,
} from './driver/tree.js';

export { isPlatformLocator, isRegexTextMatch, isResolvedLocator } from './driver/locator.js';
export type {
  AndLocator,
  CssLocator,
  KnownNativeEngine,
  LabelLocator,
  Locator,
  LocatorFilter,
  LocatorKind,
  LocatorOptions,
  NativeEngine,
  NativeLocator,
  OrLocator,
  PlainTextMatch,
  PlatformLocator,
  PlatformLocatorBranches,
  RegexSpec,
  RegexTextMatch,
  ResolvedLocator,
  RoleLocator,
  TestIdLocator,
  TextLocator,
  TextMatch,
  WithinLocator,
  XPathLocator,
} from './driver/locator.js';

export { isLocatorTarget, isNodeTarget, isPointTarget } from './driver/actions.js';
export type {
  ActedOn,
  ActionOptions,
  ActionResult,
  CallOptions,
  Checks,
  Direction,
  DragOptions,
  HitTestResult,
  Key,
  KnownTypeMethod,
  LocatorTarget,
  LongPressOptions,
  NamedKey,
  NodeTarget,
  PinchOptions,
  PointTarget,
  ScrollIntoViewOptions,
  ScrollIntoViewResult,
  ScrollOptions,
  ScrollResult,
  SwipeOptions,
  Target,
  TypeMethod,
  TypeMode,
  TypeOptions,
  TypeResult,
} from './driver/actions.js';

export type {
  ImageFormat,
  KnownImageFormat,
  Screenshot,
  ScreenshotOptions,
} from './driver/screenshot.js';

export {
  KNOWN_ERROR_CODES,
  NOT_INTERACTABLE_REASONS,
  PrismError,
  defaultRetryable,
  isKnownErrorCode,
  isPrismError,
} from './driver/errors.js';
export type {
  ErrorCode,
  KnownErrorCode,
  KnownNotInteractableReason,
  NotInteractableReason,
  PrismErrorOptions,
  WireError,
} from './driver/errors.js';

export { KNOWN_CAPABILITIES } from './driver/capabilities.js';
export type { Capability, KnownCapability } from './driver/capabilities.js';

export type {
  AppSpec,
  DeviceInfo,
  Driver,
  DriverLaunchOptions,
  DriverSession,
  FindOptions,
  SessionInfo,
  TreeOptions,
  WaitForIdleOptions,
} from './driver/driver.js';

export { PROTOCOL_VERSION } from './driver/wire.js';
export type {
  AgentInfo,
  GapFrame,
  HealthBody,
  HelloParams,
  HelloResult,
  KnownEventSource,
  ProtocolRange,
  ProtocolVersion,
  ResumeFrame,
  Timing,
  VersionBody,
  WireEvent,
  WireFailure,
  WireRequest,
  WireResponse,
  WireScreenshot,
  WireSuccess,
} from './driver/wire.js';
