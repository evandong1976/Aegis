// Aegis fn/globe key listener (macOS). Electron's globalShortcut can't bind fn alone, so this
// add-on watches keyboard events with a listen-only CGEventTap and reports one event:
//   'tap'  fn pressed and released with no other key or modifier in between
// Aegis toggles the mini panel on a tap (MEGA_PROMPT §5.8). Holding fn to type fn+F-keys, or fn
// with any other key, is not a tap. Listen-only: it never blocks, changes or records keys.
// Requires the Input Monitoring permission.
//
// Adapted from Klair's add-on (written before HackHarvard 2026, declared on Devpost); the chord
// shortcuts Klair needed are removed. Build with `pnpm build:native`.
#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdlib.h>

#define KEY_FN 63
#define KEY_GLOBE 179

static napi_threadsafe_function tsfn = NULL;
static CFMachPortRef tap = NULL;
static CFRunLoopSourceRef source = NULL;
static CFRunLoopRef loop = NULL;
static pthread_t thread;
static bool running = false;
static bool fn_down = false;
static bool other_key = false;

static void call_js(napi_env env, napi_value cb, void *context, void *data) {
  if (env != NULL && cb != NULL) {
    napi_value argv[1];
    napi_value global;
    napi_create_string_utf8(env, "tap", NAPI_AUTO_LENGTH, &argv[0]);
    napi_get_global(env, &global);
    napi_call_function(env, global, cb, 1, argv, NULL);
  }
}

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (tap != NULL) CGEventTapEnable(tap, true);
    return event;
  }
  int64_t keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  if (type == kCGEventFlagsChanged && (keycode == KEY_FN || keycode == KEY_GLOBE)) {
    bool down = (CGEventGetFlags(event) & kCGEventFlagMaskSecondaryFn) != 0;
    if (down && !fn_down) {
      fn_down = true;
      other_key = false;
    } else if (!down && fn_down) {
      fn_down = false;
      if (!other_key && tsfn != NULL) napi_call_threadsafe_function(tsfn, NULL, napi_tsfn_nonblocking);
    }
  } else if (fn_down && (type == kCGEventFlagsChanged || type == kCGEventKeyDown)) {
    other_key = true; // another key or modifier joined fn: not a clean tap
  }
  return event;
}

static void *run_loop(void *arg) {
  loop = CFRunLoopGetCurrent();
  CFRunLoopAddSource(loop, source, kCFRunLoopCommonModes);
  CGEventTapEnable(tap, true);
  CFRunLoopRun();
  return NULL;
}

// start(cb): true when listening; false when Input Monitoring isn't granted (this call also asks
// macOS for it, which is what lists the app in System Settings) or the tap couldn't be created.
static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_value result;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (running) {
    napi_get_boolean(env, true, &result);
    return result;
  }
  if (!CGPreflightListenEventAccess()) {
    CGRequestListenEventAccess();
    napi_get_boolean(env, false, &result);
    return result;
  }
  CGEventMask mask = CGEventMaskBit(kCGEventFlagsChanged) | CGEventMaskBit(kCGEventKeyDown);
  tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly,
                         mask, on_event, NULL);
  if (tap == NULL) {
    napi_get_boolean(env, false, &result);
    return result;
  }
  source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
  napi_value name;
  napi_create_string_utf8(env, "aegis-fn-key", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, call_js, &tsfn);
  napi_unref_threadsafe_function(env, tsfn); // don't keep the process alive
  pthread_create(&thread, NULL, run_loop, NULL);
  running = true;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  if (running) {
    if (tap != NULL) CGEventTapEnable(tap, false);
    if (loop != NULL) CFRunLoopStop(loop);
    pthread_join(thread, NULL);
    if (source != NULL) CFRelease(source);
    if (tap != NULL) CFRelease(tap);
    source = NULL;
    tap = NULL;
    loop = NULL;
    if (tsfn != NULL) napi_release_threadsafe_function(tsfn, napi_tsfn_release);
    tsfn = NULL;
    running = false;
  }
  return NULL;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn_start, fn_stop;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn_start);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stop, NULL, &fn_stop);
  napi_set_named_property(env, exports, "start", fn_start);
  napi_set_named_property(env, exports, "stop", fn_stop);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
