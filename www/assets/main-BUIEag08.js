/* empty css               */
(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) return;
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) processPreload(link);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
    }
  }).observe(document, {
    childList: true,
    subtree: true
  });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep) return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
var flushPending = false;
var flushing = false;
var queue = [];
var lastFlushedIndex = -1;
function scheduler(callback) {
  queueJob(callback);
}
function queueJob(job) {
  if (!queue.includes(job))
    queue.push(job);
  queueFlush();
}
function dequeueJob(job) {
  let index = queue.indexOf(job);
  if (index !== -1 && index > lastFlushedIndex)
    queue.splice(index, 1);
}
function queueFlush() {
  if (!flushing && !flushPending) {
    flushPending = true;
    queueMicrotask(flushJobs);
  }
}
function flushJobs() {
  flushPending = false;
  flushing = true;
  for (let i = 0; i < queue.length; i++) {
    queue[i]();
    lastFlushedIndex = i;
  }
  queue.length = 0;
  lastFlushedIndex = -1;
  flushing = false;
}
var reactive;
var effect;
var release;
var raw;
var shouldSchedule = true;
function disableEffectScheduling(callback) {
  shouldSchedule = false;
  callback();
  shouldSchedule = true;
}
function setReactivityEngine(engine) {
  reactive = engine.reactive;
  release = engine.release;
  effect = (callback) => engine.effect(callback, { scheduler: (task) => {
    if (shouldSchedule) {
      scheduler(task);
    } else {
      task();
    }
  } });
  raw = engine.raw;
}
function overrideEffect(override) {
  effect = override;
}
function elementBoundEffect(el) {
  let cleanup2 = () => {
  };
  let wrappedEffect = (callback) => {
    let effectReference = effect(callback);
    if (!el._x_effects) {
      el._x_effects = /* @__PURE__ */ new Set();
      el._x_runEffects = () => {
        el._x_effects.forEach((i) => i());
      };
    }
    el._x_effects.add(effectReference);
    cleanup2 = () => {
      if (effectReference === void 0)
        return;
      el._x_effects.delete(effectReference);
      release(effectReference);
    };
    return effectReference;
  };
  return [wrappedEffect, () => {
    cleanup2();
  }];
}
function watch(getter, callback) {
  let firstTime = true;
  let oldValue;
  let effectReference = effect(() => {
    let value = getter();
    JSON.stringify(value);
    if (!firstTime) {
      queueMicrotask(() => {
        callback(value, oldValue);
        oldValue = value;
      });
    } else {
      oldValue = value;
    }
    firstTime = false;
  });
  return () => release(effectReference);
}
var onAttributeAddeds = [];
var onElRemoveds = [];
var onElAddeds = [];
function onElAdded(callback) {
  onElAddeds.push(callback);
}
function onElRemoved(el, callback) {
  if (typeof callback === "function") {
    if (!el._x_cleanups)
      el._x_cleanups = [];
    el._x_cleanups.push(callback);
  } else {
    callback = el;
    onElRemoveds.push(callback);
  }
}
function onAttributesAdded(callback) {
  onAttributeAddeds.push(callback);
}
function onAttributeRemoved(el, name, callback) {
  if (!el._x_attributeCleanups)
    el._x_attributeCleanups = {};
  if (!el._x_attributeCleanups[name])
    el._x_attributeCleanups[name] = [];
  el._x_attributeCleanups[name].push(callback);
}
function cleanupAttributes(el, names) {
  if (!el._x_attributeCleanups)
    return;
  Object.entries(el._x_attributeCleanups).forEach(([name, value]) => {
    if (names === void 0 || names.includes(name)) {
      value.forEach((i) => i());
      delete el._x_attributeCleanups[name];
    }
  });
}
function cleanupElement(el) {
  el._x_effects?.forEach(dequeueJob);
  while (el._x_cleanups?.length)
    el._x_cleanups.pop()();
}
var observer = new MutationObserver(onMutate);
var currentlyObserving = false;
function startObservingMutations() {
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
  currentlyObserving = true;
}
function stopObservingMutations() {
  flushObserver();
  observer.disconnect();
  currentlyObserving = false;
}
var queuedMutations = [];
function flushObserver() {
  let records = observer.takeRecords();
  queuedMutations.push(() => records.length > 0 && onMutate(records));
  let queueLengthWhenTriggered = queuedMutations.length;
  queueMicrotask(() => {
    if (queuedMutations.length === queueLengthWhenTriggered) {
      while (queuedMutations.length > 0)
        queuedMutations.shift()();
    }
  });
}
function mutateDom(callback) {
  if (!currentlyObserving)
    return callback();
  stopObservingMutations();
  let result = callback();
  startObservingMutations();
  return result;
}
var isCollecting = false;
var deferredMutations = [];
function deferMutations() {
  isCollecting = true;
}
function flushAndStopDeferringMutations() {
  isCollecting = false;
  onMutate(deferredMutations);
  deferredMutations = [];
}
function onMutate(mutations) {
  if (isCollecting) {
    deferredMutations = deferredMutations.concat(mutations);
    return;
  }
  let addedNodes = [];
  let removedNodes = /* @__PURE__ */ new Set();
  let addedAttributes = /* @__PURE__ */ new Map();
  let removedAttributes = /* @__PURE__ */ new Map();
  for (let i = 0; i < mutations.length; i++) {
    if (mutations[i].target._x_ignoreMutationObserver)
      continue;
    if (mutations[i].type === "childList") {
      mutations[i].removedNodes.forEach((node) => {
        if (node.nodeType !== 1)
          return;
        if (!node._x_marker)
          return;
        removedNodes.add(node);
      });
      mutations[i].addedNodes.forEach((node) => {
        if (node.nodeType !== 1)
          return;
        if (removedNodes.has(node)) {
          removedNodes.delete(node);
          return;
        }
        if (node._x_marker)
          return;
        addedNodes.push(node);
      });
    }
    if (mutations[i].type === "attributes") {
      let el = mutations[i].target;
      let name = mutations[i].attributeName;
      let oldValue = mutations[i].oldValue;
      let add2 = () => {
        if (!addedAttributes.has(el))
          addedAttributes.set(el, []);
        addedAttributes.get(el).push({ name, value: el.getAttribute(name) });
      };
      let remove = () => {
        if (!removedAttributes.has(el))
          removedAttributes.set(el, []);
        removedAttributes.get(el).push(name);
      };
      if (el.hasAttribute(name) && oldValue === null) {
        add2();
      } else if (el.hasAttribute(name)) {
        remove();
        add2();
      } else {
        remove();
      }
    }
  }
  removedAttributes.forEach((attrs, el) => {
    cleanupAttributes(el, attrs);
  });
  addedAttributes.forEach((attrs, el) => {
    onAttributeAddeds.forEach((i) => i(el, attrs));
  });
  for (let node of removedNodes) {
    if (addedNodes.some((i) => i.contains(node)))
      continue;
    onElRemoveds.forEach((i) => i(node));
  }
  for (let node of addedNodes) {
    if (!node.isConnected)
      continue;
    onElAddeds.forEach((i) => i(node));
  }
  addedNodes = null;
  removedNodes = null;
  addedAttributes = null;
  removedAttributes = null;
}
function scope(node) {
  return mergeProxies(closestDataStack(node));
}
function addScopeToNode(node, data2, referenceNode) {
  node._x_dataStack = [data2, ...closestDataStack(referenceNode || node)];
  return () => {
    node._x_dataStack = node._x_dataStack.filter((i) => i !== data2);
  };
}
function closestDataStack(node) {
  if (node._x_dataStack)
    return node._x_dataStack;
  if (typeof ShadowRoot === "function" && node instanceof ShadowRoot) {
    return closestDataStack(node.host);
  }
  if (!node.parentNode) {
    return [];
  }
  return closestDataStack(node.parentNode);
}
function mergeProxies(objects) {
  return new Proxy({ objects }, mergeProxyTrap);
}
var mergeProxyTrap = {
  ownKeys({ objects }) {
    return Array.from(
      new Set(objects.flatMap((i) => Object.keys(i)))
    );
  },
  has({ objects }, name) {
    if (name == Symbol.unscopables)
      return false;
    return objects.some(
      (obj) => Object.prototype.hasOwnProperty.call(obj, name) || Reflect.has(obj, name)
    );
  },
  get({ objects }, name, thisProxy) {
    if (name == "toJSON")
      return collapseProxies;
    return Reflect.get(
      objects.find(
        (obj) => Reflect.has(obj, name)
      ) || {},
      name,
      thisProxy
    );
  },
  set({ objects }, name, value, thisProxy) {
    const target = objects.find(
      (obj) => Object.prototype.hasOwnProperty.call(obj, name)
    ) || objects[objects.length - 1];
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor?.set && descriptor?.get)
      return descriptor.set.call(thisProxy, value) || true;
    return Reflect.set(target, name, value);
  }
};
function collapseProxies() {
  let keys = Reflect.ownKeys(this);
  return keys.reduce((acc, key) => {
    acc[key] = Reflect.get(this, key);
    return acc;
  }, {});
}
function initInterceptors(data2) {
  let isObject2 = (val) => typeof val === "object" && !Array.isArray(val) && val !== null;
  let recurse = (obj, basePath = "") => {
    Object.entries(Object.getOwnPropertyDescriptors(obj)).forEach(([key, { value, enumerable }]) => {
      if (enumerable === false || value === void 0)
        return;
      if (typeof value === "object" && value !== null && value.__v_skip)
        return;
      let path = basePath === "" ? key : `${basePath}.${key}`;
      if (typeof value === "object" && value !== null && value._x_interceptor) {
        obj[key] = value.initialize(data2, path, key);
      } else {
        if (isObject2(value) && value !== obj && !(value instanceof Element)) {
          recurse(value, path);
        }
      }
    });
  };
  return recurse(data2);
}
function interceptor(callback, mutateObj = () => {
}) {
  let obj = {
    initialValue: void 0,
    _x_interceptor: true,
    initialize(data2, path, key) {
      return callback(this.initialValue, () => get(data2, path), (value) => set(data2, path, value), path, key);
    }
  };
  mutateObj(obj);
  return (initialValue) => {
    if (typeof initialValue === "object" && initialValue !== null && initialValue._x_interceptor) {
      let initialize = obj.initialize.bind(obj);
      obj.initialize = (data2, path, key) => {
        let innerValue = initialValue.initialize(data2, path, key);
        obj.initialValue = innerValue;
        return initialize(data2, path, key);
      };
    } else {
      obj.initialValue = initialValue;
    }
    return obj;
  };
}
function get(obj, path) {
  return path.split(".").reduce((carry, segment) => carry[segment], obj);
}
function set(obj, path, value) {
  if (typeof path === "string")
    path = path.split(".");
  if (path.length === 1)
    obj[path[0]] = value;
  else if (path.length === 0)
    throw error;
  else {
    if (obj[path[0]])
      return set(obj[path[0]], path.slice(1), value);
    else {
      obj[path[0]] = {};
      return set(obj[path[0]], path.slice(1), value);
    }
  }
}
var magics = {};
function magic(name, callback) {
  magics[name] = callback;
}
function injectMagics(obj, el) {
  let memoizedUtilities = getUtilities(el);
  Object.entries(magics).forEach(([name, callback]) => {
    Object.defineProperty(obj, `$${name}`, {
      get() {
        return callback(el, memoizedUtilities);
      },
      enumerable: false
    });
  });
  return obj;
}
function getUtilities(el) {
  let [utilities, cleanup2] = getElementBoundUtilities(el);
  let utils = { interceptor, ...utilities };
  onElRemoved(el, cleanup2);
  return utils;
}
function tryCatch(el, expression, callback, ...args) {
  try {
    return callback(...args);
  } catch (e) {
    handleError(e, el, expression);
  }
}
function handleError(error2, el, expression = void 0) {
  error2 = Object.assign(
    error2 ?? { message: "No error message given." },
    { el, expression }
  );
  console.warn(`Alpine Expression Error: ${error2.message}

${expression ? 'Expression: "' + expression + '"\n\n' : ""}`, el);
  setTimeout(() => {
    throw error2;
  }, 0);
}
var shouldAutoEvaluateFunctions = true;
function dontAutoEvaluateFunctions(callback) {
  let cache = shouldAutoEvaluateFunctions;
  shouldAutoEvaluateFunctions = false;
  let result = callback();
  shouldAutoEvaluateFunctions = cache;
  return result;
}
function evaluate(el, expression, extras = {}) {
  let result;
  evaluateLater(el, expression)((value) => result = value, extras);
  return result;
}
function evaluateLater(...args) {
  return theEvaluatorFunction(...args);
}
var theEvaluatorFunction = normalEvaluator;
function setEvaluator(newEvaluator) {
  theEvaluatorFunction = newEvaluator;
}
function normalEvaluator(el, expression) {
  let overriddenMagics = {};
  injectMagics(overriddenMagics, el);
  let dataStack = [overriddenMagics, ...closestDataStack(el)];
  let evaluator = typeof expression === "function" ? generateEvaluatorFromFunction(dataStack, expression) : generateEvaluatorFromString(dataStack, expression, el);
  return tryCatch.bind(null, el, expression, evaluator);
}
function generateEvaluatorFromFunction(dataStack, func) {
  return (receiver = () => {
  }, { scope: scope2 = {}, params = [] } = {}) => {
    let result = func.apply(mergeProxies([scope2, ...dataStack]), params);
    runIfTypeOfFunction(receiver, result);
  };
}
var evaluatorMemo = {};
function generateFunctionFromString(expression, el) {
  if (evaluatorMemo[expression]) {
    return evaluatorMemo[expression];
  }
  let AsyncFunction = Object.getPrototypeOf(async function() {
  }).constructor;
  let rightSideSafeExpression = /^[\n\s]*if.*\(.*\)/.test(expression.trim()) || /^(let|const)\s/.test(expression.trim()) ? `(async()=>{ ${expression} })()` : expression;
  const safeAsyncFunction = () => {
    try {
      let func2 = new AsyncFunction(
        ["__self", "scope"],
        `with (scope) { __self.result = ${rightSideSafeExpression} }; __self.finished = true; return __self.result;`
      );
      Object.defineProperty(func2, "name", {
        value: `[Alpine] ${expression}`
      });
      return func2;
    } catch (error2) {
      handleError(error2, el, expression);
      return Promise.resolve();
    }
  };
  let func = safeAsyncFunction();
  evaluatorMemo[expression] = func;
  return func;
}
function generateEvaluatorFromString(dataStack, expression, el) {
  let func = generateFunctionFromString(expression, el);
  return (receiver = () => {
  }, { scope: scope2 = {}, params = [] } = {}) => {
    func.result = void 0;
    func.finished = false;
    let completeScope = mergeProxies([scope2, ...dataStack]);
    if (typeof func === "function") {
      let promise = func(func, completeScope).catch((error2) => handleError(error2, el, expression));
      if (func.finished) {
        runIfTypeOfFunction(receiver, func.result, completeScope, params, el);
        func.result = void 0;
      } else {
        promise.then((result) => {
          runIfTypeOfFunction(receiver, result, completeScope, params, el);
        }).catch((error2) => handleError(error2, el, expression)).finally(() => func.result = void 0);
      }
    }
  };
}
function runIfTypeOfFunction(receiver, value, scope2, params, el) {
  if (shouldAutoEvaluateFunctions && typeof value === "function") {
    let result = value.apply(scope2, params);
    if (result instanceof Promise) {
      result.then((i) => runIfTypeOfFunction(receiver, i, scope2, params)).catch((error2) => handleError(error2, el, value));
    } else {
      receiver(result);
    }
  } else if (typeof value === "object" && value instanceof Promise) {
    value.then((i) => receiver(i));
  } else {
    receiver(value);
  }
}
var prefixAsString = "x-";
function prefix(subject = "") {
  return prefixAsString + subject;
}
function setPrefix(newPrefix) {
  prefixAsString = newPrefix;
}
var directiveHandlers = {};
function directive(name, callback) {
  directiveHandlers[name] = callback;
  return {
    before(directive2) {
      if (!directiveHandlers[directive2]) {
        console.warn(String.raw`Cannot find directive \`${directive2}\`. \`${name}\` will use the default order of execution`);
        return;
      }
      const pos = directiveOrder.indexOf(directive2);
      directiveOrder.splice(pos >= 0 ? pos : directiveOrder.indexOf("DEFAULT"), 0, name);
    }
  };
}
function directiveExists(name) {
  return Object.keys(directiveHandlers).includes(name);
}
function directives(el, attributes, originalAttributeOverride) {
  attributes = Array.from(attributes);
  if (el._x_virtualDirectives) {
    let vAttributes = Object.entries(el._x_virtualDirectives).map(([name, value]) => ({ name, value }));
    let staticAttributes = attributesOnly(vAttributes);
    vAttributes = vAttributes.map((attribute) => {
      if (staticAttributes.find((attr) => attr.name === attribute.name)) {
        return {
          name: `x-bind:${attribute.name}`,
          value: `"${attribute.value}"`
        };
      }
      return attribute;
    });
    attributes = attributes.concat(vAttributes);
  }
  let transformedAttributeMap = {};
  let directives2 = attributes.map(toTransformedAttributes((newName, oldName) => transformedAttributeMap[newName] = oldName)).filter(outNonAlpineAttributes).map(toParsedDirectives(transformedAttributeMap, originalAttributeOverride)).sort(byPriority);
  return directives2.map((directive2) => {
    return getDirectiveHandler(el, directive2);
  });
}
function attributesOnly(attributes) {
  return Array.from(attributes).map(toTransformedAttributes()).filter((attr) => !outNonAlpineAttributes(attr));
}
var isDeferringHandlers = false;
var directiveHandlerStacks = /* @__PURE__ */ new Map();
var currentHandlerStackKey = Symbol();
function deferHandlingDirectives(callback) {
  isDeferringHandlers = true;
  let key = Symbol();
  currentHandlerStackKey = key;
  directiveHandlerStacks.set(key, []);
  let flushHandlers = () => {
    while (directiveHandlerStacks.get(key).length)
      directiveHandlerStacks.get(key).shift()();
    directiveHandlerStacks.delete(key);
  };
  let stopDeferring = () => {
    isDeferringHandlers = false;
    flushHandlers();
  };
  callback(flushHandlers);
  stopDeferring();
}
function getElementBoundUtilities(el) {
  let cleanups = [];
  let cleanup2 = (callback) => cleanups.push(callback);
  let [effect3, cleanupEffect] = elementBoundEffect(el);
  cleanups.push(cleanupEffect);
  let utilities = {
    Alpine: alpine_default,
    effect: effect3,
    cleanup: cleanup2,
    evaluateLater: evaluateLater.bind(evaluateLater, el),
    evaluate: evaluate.bind(evaluate, el)
  };
  let doCleanup = () => cleanups.forEach((i) => i());
  return [utilities, doCleanup];
}
function getDirectiveHandler(el, directive2) {
  let noop = () => {
  };
  let handler4 = directiveHandlers[directive2.type] || noop;
  let [utilities, cleanup2] = getElementBoundUtilities(el);
  onAttributeRemoved(el, directive2.original, cleanup2);
  let fullHandler = () => {
    if (el._x_ignore || el._x_ignoreSelf)
      return;
    handler4.inline && handler4.inline(el, directive2, utilities);
    handler4 = handler4.bind(handler4, el, directive2, utilities);
    isDeferringHandlers ? directiveHandlerStacks.get(currentHandlerStackKey).push(handler4) : handler4();
  };
  fullHandler.runCleanups = cleanup2;
  return fullHandler;
}
var startingWith = (subject, replacement) => ({ name, value }) => {
  if (name.startsWith(subject))
    name = name.replace(subject, replacement);
  return { name, value };
};
var into = (i) => i;
function toTransformedAttributes(callback = () => {
}) {
  return ({ name, value }) => {
    let { name: newName, value: newValue } = attributeTransformers.reduce((carry, transform) => {
      return transform(carry);
    }, { name, value });
    if (newName !== name)
      callback(newName, name);
    return { name: newName, value: newValue };
  };
}
var attributeTransformers = [];
function mapAttributes(callback) {
  attributeTransformers.push(callback);
}
function outNonAlpineAttributes({ name }) {
  return alpineAttributeRegex().test(name);
}
var alpineAttributeRegex = () => new RegExp(`^${prefixAsString}([^:^.]+)\\b`);
function toParsedDirectives(transformedAttributeMap, originalAttributeOverride) {
  return ({ name, value }) => {
    let typeMatch = name.match(alpineAttributeRegex());
    let valueMatch = name.match(/:([a-zA-Z0-9\-_:]+)/);
    let modifiers = name.match(/\.[^.\]]+(?=[^\]]*$)/g) || [];
    let original = originalAttributeOverride || transformedAttributeMap[name] || name;
    return {
      type: typeMatch ? typeMatch[1] : null,
      value: valueMatch ? valueMatch[1] : null,
      modifiers: modifiers.map((i) => i.replace(".", "")),
      expression: value,
      original
    };
  };
}
var DEFAULT = "DEFAULT";
var directiveOrder = [
  "ignore",
  "ref",
  "data",
  "id",
  "anchor",
  "bind",
  "init",
  "for",
  "model",
  "modelable",
  "transition",
  "show",
  "if",
  DEFAULT,
  "teleport"
];
function byPriority(a, b) {
  let typeA = directiveOrder.indexOf(a.type) === -1 ? DEFAULT : a.type;
  let typeB = directiveOrder.indexOf(b.type) === -1 ? DEFAULT : b.type;
  return directiveOrder.indexOf(typeA) - directiveOrder.indexOf(typeB);
}
function dispatch(el, name, detail = {}) {
  el.dispatchEvent(
    new CustomEvent(name, {
      detail,
      bubbles: true,
      // Allows events to pass the shadow DOM barrier.
      composed: true,
      cancelable: true
    })
  );
}
function walk(el, callback) {
  if (typeof ShadowRoot === "function" && el instanceof ShadowRoot) {
    Array.from(el.children).forEach((el2) => walk(el2, callback));
    return;
  }
  let skip = false;
  callback(el, () => skip = true);
  if (skip)
    return;
  let node = el.firstElementChild;
  while (node) {
    walk(node, callback);
    node = node.nextElementSibling;
  }
}
function warn(message, ...args) {
  console.warn(`Alpine Warning: ${message}`, ...args);
}
var started = false;
function start() {
  if (started)
    warn("Alpine has already been initialized on this page. Calling Alpine.start() more than once can cause problems.");
  started = true;
  if (!document.body)
    warn("Unable to initialize. Trying to load Alpine before `<body>` is available. Did you forget to add `defer` in Alpine's `<script>` tag?");
  dispatch(document, "alpine:init");
  dispatch(document, "alpine:initializing");
  startObservingMutations();
  onElAdded((el) => initTree(el, walk));
  onElRemoved((el) => destroyTree(el));
  onAttributesAdded((el, attrs) => {
    directives(el, attrs).forEach((handle) => handle());
  });
  let outNestedComponents = (el) => !closestRoot(el.parentElement, true);
  Array.from(document.querySelectorAll(allSelectors().join(","))).filter(outNestedComponents).forEach((el) => {
    initTree(el);
  });
  dispatch(document, "alpine:initialized");
  setTimeout(() => {
    warnAboutMissingPlugins();
  });
}
var rootSelectorCallbacks = [];
var initSelectorCallbacks = [];
function rootSelectors() {
  return rootSelectorCallbacks.map((fn) => fn());
}
function allSelectors() {
  return rootSelectorCallbacks.concat(initSelectorCallbacks).map((fn) => fn());
}
function addRootSelector(selectorCallback) {
  rootSelectorCallbacks.push(selectorCallback);
}
function addInitSelector(selectorCallback) {
  initSelectorCallbacks.push(selectorCallback);
}
function closestRoot(el, includeInitSelectors = false) {
  return findClosest(el, (element) => {
    const selectors = includeInitSelectors ? allSelectors() : rootSelectors();
    if (selectors.some((selector) => element.matches(selector)))
      return true;
  });
}
function findClosest(el, callback) {
  if (!el)
    return;
  if (callback(el))
    return el;
  if (el._x_teleportBack)
    el = el._x_teleportBack;
  if (!el.parentElement)
    return;
  return findClosest(el.parentElement, callback);
}
function isRoot(el) {
  return rootSelectors().some((selector) => el.matches(selector));
}
var initInterceptors2 = [];
function interceptInit(callback) {
  initInterceptors2.push(callback);
}
var markerDispenser = 1;
function initTree(el, walker = walk, intercept = () => {
}) {
  if (findClosest(el, (i) => i._x_ignore))
    return;
  deferHandlingDirectives(() => {
    walker(el, (el2, skip) => {
      if (el2._x_marker)
        return;
      intercept(el2, skip);
      initInterceptors2.forEach((i) => i(el2, skip));
      directives(el2, el2.attributes).forEach((handle) => handle());
      if (!el2._x_ignore)
        el2._x_marker = markerDispenser++;
      el2._x_ignore && skip();
    });
  });
}
function destroyTree(root, walker = walk) {
  walker(root, (el) => {
    cleanupElement(el);
    cleanupAttributes(el);
    delete el._x_marker;
  });
}
function warnAboutMissingPlugins() {
  let pluginDirectives = [
    ["ui", "dialog", ["[x-dialog], [x-popover]"]],
    ["anchor", "anchor", ["[x-anchor]"]],
    ["sort", "sort", ["[x-sort]"]]
  ];
  pluginDirectives.forEach(([plugin2, directive2, selectors]) => {
    if (directiveExists(directive2))
      return;
    selectors.some((selector) => {
      if (document.querySelector(selector)) {
        warn(`found "${selector}", but missing ${plugin2} plugin`);
        return true;
      }
    });
  });
}
var tickStack = [];
var isHolding = false;
function nextTick(callback = () => {
}) {
  queueMicrotask(() => {
    isHolding || setTimeout(() => {
      releaseNextTicks();
    });
  });
  return new Promise((res) => {
    tickStack.push(() => {
      callback();
      res();
    });
  });
}
function releaseNextTicks() {
  isHolding = false;
  while (tickStack.length)
    tickStack.shift()();
}
function holdNextTicks() {
  isHolding = true;
}
function setClasses(el, value) {
  if (Array.isArray(value)) {
    return setClassesFromString(el, value.join(" "));
  } else if (typeof value === "object" && value !== null) {
    return setClassesFromObject(el, value);
  } else if (typeof value === "function") {
    return setClasses(el, value());
  }
  return setClassesFromString(el, value);
}
function setClassesFromString(el, classString) {
  let missingClasses = (classString2) => classString2.split(" ").filter((i) => !el.classList.contains(i)).filter(Boolean);
  let addClassesAndReturnUndo = (classes) => {
    el.classList.add(...classes);
    return () => {
      el.classList.remove(...classes);
    };
  };
  classString = classString === true ? classString = "" : classString || "";
  return addClassesAndReturnUndo(missingClasses(classString));
}
function setClassesFromObject(el, classObject) {
  let split = (classString) => classString.split(" ").filter(Boolean);
  let forAdd = Object.entries(classObject).flatMap(([classString, bool]) => bool ? split(classString) : false).filter(Boolean);
  let forRemove = Object.entries(classObject).flatMap(([classString, bool]) => !bool ? split(classString) : false).filter(Boolean);
  let added = [];
  let removed = [];
  forRemove.forEach((i) => {
    if (el.classList.contains(i)) {
      el.classList.remove(i);
      removed.push(i);
    }
  });
  forAdd.forEach((i) => {
    if (!el.classList.contains(i)) {
      el.classList.add(i);
      added.push(i);
    }
  });
  return () => {
    removed.forEach((i) => el.classList.add(i));
    added.forEach((i) => el.classList.remove(i));
  };
}
function setStyles(el, value) {
  if (typeof value === "object" && value !== null) {
    return setStylesFromObject(el, value);
  }
  return setStylesFromString(el, value);
}
function setStylesFromObject(el, value) {
  let previousStyles = {};
  Object.entries(value).forEach(([key, value2]) => {
    previousStyles[key] = el.style[key];
    if (!key.startsWith("--")) {
      key = kebabCase(key);
    }
    el.style.setProperty(key, value2);
  });
  setTimeout(() => {
    if (el.style.length === 0) {
      el.removeAttribute("style");
    }
  });
  return () => {
    setStyles(el, previousStyles);
  };
}
function setStylesFromString(el, value) {
  let cache = el.getAttribute("style", value);
  el.setAttribute("style", value);
  return () => {
    el.setAttribute("style", cache || "");
  };
}
function kebabCase(subject) {
  return subject.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
function once(callback, fallback = () => {
}) {
  let called = false;
  return function() {
    if (!called) {
      called = true;
      callback.apply(this, arguments);
    } else {
      fallback.apply(this, arguments);
    }
  };
}
directive("transition", (el, { value, modifiers, expression }, { evaluate: evaluate2 }) => {
  if (typeof expression === "function")
    expression = evaluate2(expression);
  if (expression === false)
    return;
  if (!expression || typeof expression === "boolean") {
    registerTransitionsFromHelper(el, modifiers, value);
  } else {
    registerTransitionsFromClassString(el, expression, value);
  }
});
function registerTransitionsFromClassString(el, classString, stage) {
  registerTransitionObject(el, setClasses, "");
  let directiveStorageMap = {
    "enter": (classes) => {
      el._x_transition.enter.during = classes;
    },
    "enter-start": (classes) => {
      el._x_transition.enter.start = classes;
    },
    "enter-end": (classes) => {
      el._x_transition.enter.end = classes;
    },
    "leave": (classes) => {
      el._x_transition.leave.during = classes;
    },
    "leave-start": (classes) => {
      el._x_transition.leave.start = classes;
    },
    "leave-end": (classes) => {
      el._x_transition.leave.end = classes;
    }
  };
  directiveStorageMap[stage](classString);
}
function registerTransitionsFromHelper(el, modifiers, stage) {
  registerTransitionObject(el, setStyles);
  let doesntSpecify = !modifiers.includes("in") && !modifiers.includes("out") && !stage;
  let transitioningIn = doesntSpecify || modifiers.includes("in") || ["enter"].includes(stage);
  let transitioningOut = doesntSpecify || modifiers.includes("out") || ["leave"].includes(stage);
  if (modifiers.includes("in") && !doesntSpecify) {
    modifiers = modifiers.filter((i, index) => index < modifiers.indexOf("out"));
  }
  if (modifiers.includes("out") && !doesntSpecify) {
    modifiers = modifiers.filter((i, index) => index > modifiers.indexOf("out"));
  }
  let wantsAll = !modifiers.includes("opacity") && !modifiers.includes("scale");
  let wantsOpacity = wantsAll || modifiers.includes("opacity");
  let wantsScale = wantsAll || modifiers.includes("scale");
  let opacityValue = wantsOpacity ? 0 : 1;
  let scaleValue = wantsScale ? modifierValue(modifiers, "scale", 95) / 100 : 1;
  let delay = modifierValue(modifiers, "delay", 0) / 1e3;
  let origin = modifierValue(modifiers, "origin", "center");
  let property = "opacity, transform";
  let durationIn = modifierValue(modifiers, "duration", 150) / 1e3;
  let durationOut = modifierValue(modifiers, "duration", 75) / 1e3;
  let easing = `cubic-bezier(0.4, 0.0, 0.2, 1)`;
  if (transitioningIn) {
    el._x_transition.enter.during = {
      transformOrigin: origin,
      transitionDelay: `${delay}s`,
      transitionProperty: property,
      transitionDuration: `${durationIn}s`,
      transitionTimingFunction: easing
    };
    el._x_transition.enter.start = {
      opacity: opacityValue,
      transform: `scale(${scaleValue})`
    };
    el._x_transition.enter.end = {
      opacity: 1,
      transform: `scale(1)`
    };
  }
  if (transitioningOut) {
    el._x_transition.leave.during = {
      transformOrigin: origin,
      transitionDelay: `${delay}s`,
      transitionProperty: property,
      transitionDuration: `${durationOut}s`,
      transitionTimingFunction: easing
    };
    el._x_transition.leave.start = {
      opacity: 1,
      transform: `scale(1)`
    };
    el._x_transition.leave.end = {
      opacity: opacityValue,
      transform: `scale(${scaleValue})`
    };
  }
}
function registerTransitionObject(el, setFunction, defaultValue = {}) {
  if (!el._x_transition)
    el._x_transition = {
      enter: { during: defaultValue, start: defaultValue, end: defaultValue },
      leave: { during: defaultValue, start: defaultValue, end: defaultValue },
      in(before = () => {
      }, after = () => {
      }) {
        transition(el, setFunction, {
          during: this.enter.during,
          start: this.enter.start,
          end: this.enter.end
        }, before, after);
      },
      out(before = () => {
      }, after = () => {
      }) {
        transition(el, setFunction, {
          during: this.leave.during,
          start: this.leave.start,
          end: this.leave.end
        }, before, after);
      }
    };
}
window.Element.prototype._x_toggleAndCascadeWithTransitions = function(el, value, show, hide) {
  const nextTick2 = document.visibilityState === "visible" ? requestAnimationFrame : setTimeout;
  let clickAwayCompatibleShow = () => nextTick2(show);
  if (value) {
    if (el._x_transition && (el._x_transition.enter || el._x_transition.leave)) {
      el._x_transition.enter && (Object.entries(el._x_transition.enter.during).length || Object.entries(el._x_transition.enter.start).length || Object.entries(el._x_transition.enter.end).length) ? el._x_transition.in(show) : clickAwayCompatibleShow();
    } else {
      el._x_transition ? el._x_transition.in(show) : clickAwayCompatibleShow();
    }
    return;
  }
  el._x_hidePromise = el._x_transition ? new Promise((resolve, reject) => {
    el._x_transition.out(() => {
    }, () => resolve(hide));
    el._x_transitioning && el._x_transitioning.beforeCancel(() => reject({ isFromCancelledTransition: true }));
  }) : Promise.resolve(hide);
  queueMicrotask(() => {
    let closest = closestHide(el);
    if (closest) {
      if (!closest._x_hideChildren)
        closest._x_hideChildren = [];
      closest._x_hideChildren.push(el);
    } else {
      nextTick2(() => {
        let hideAfterChildren = (el2) => {
          let carry = Promise.all([
            el2._x_hidePromise,
            ...(el2._x_hideChildren || []).map(hideAfterChildren)
          ]).then(([i]) => i?.());
          delete el2._x_hidePromise;
          delete el2._x_hideChildren;
          return carry;
        };
        hideAfterChildren(el).catch((e) => {
          if (!e.isFromCancelledTransition)
            throw e;
        });
      });
    }
  });
};
function closestHide(el) {
  let parent = el.parentNode;
  if (!parent)
    return;
  return parent._x_hidePromise ? parent : closestHide(parent);
}
function transition(el, setFunction, { during, start: start2, end } = {}, before = () => {
}, after = () => {
}) {
  if (el._x_transitioning)
    el._x_transitioning.cancel();
  if (Object.keys(during).length === 0 && Object.keys(start2).length === 0 && Object.keys(end).length === 0) {
    before();
    after();
    return;
  }
  let undoStart, undoDuring, undoEnd;
  performTransition(el, {
    start() {
      undoStart = setFunction(el, start2);
    },
    during() {
      undoDuring = setFunction(el, during);
    },
    before,
    end() {
      undoStart();
      undoEnd = setFunction(el, end);
    },
    after,
    cleanup() {
      undoDuring();
      undoEnd();
    }
  });
}
function performTransition(el, stages) {
  let interrupted, reachedBefore, reachedEnd;
  let finish = once(() => {
    mutateDom(() => {
      interrupted = true;
      if (!reachedBefore)
        stages.before();
      if (!reachedEnd) {
        stages.end();
        releaseNextTicks();
      }
      stages.after();
      if (el.isConnected)
        stages.cleanup();
      delete el._x_transitioning;
    });
  });
  el._x_transitioning = {
    beforeCancels: [],
    beforeCancel(callback) {
      this.beforeCancels.push(callback);
    },
    cancel: once(function() {
      while (this.beforeCancels.length) {
        this.beforeCancels.shift()();
      }
      finish();
    }),
    finish
  };
  mutateDom(() => {
    stages.start();
    stages.during();
  });
  holdNextTicks();
  requestAnimationFrame(() => {
    if (interrupted)
      return;
    let duration = Number(getComputedStyle(el).transitionDuration.replace(/,.*/, "").replace("s", "")) * 1e3;
    let delay = Number(getComputedStyle(el).transitionDelay.replace(/,.*/, "").replace("s", "")) * 1e3;
    if (duration === 0)
      duration = Number(getComputedStyle(el).animationDuration.replace("s", "")) * 1e3;
    mutateDom(() => {
      stages.before();
    });
    reachedBefore = true;
    requestAnimationFrame(() => {
      if (interrupted)
        return;
      mutateDom(() => {
        stages.end();
      });
      releaseNextTicks();
      setTimeout(el._x_transitioning.finish, duration + delay);
      reachedEnd = true;
    });
  });
}
function modifierValue(modifiers, key, fallback) {
  if (modifiers.indexOf(key) === -1)
    return fallback;
  const rawValue = modifiers[modifiers.indexOf(key) + 1];
  if (!rawValue)
    return fallback;
  if (key === "scale") {
    if (isNaN(rawValue))
      return fallback;
  }
  if (key === "duration" || key === "delay") {
    let match = rawValue.match(/([0-9]+)ms/);
    if (match)
      return match[1];
  }
  if (key === "origin") {
    if (["top", "right", "left", "center", "bottom"].includes(modifiers[modifiers.indexOf(key) + 2])) {
      return [rawValue, modifiers[modifiers.indexOf(key) + 2]].join(" ");
    }
  }
  return rawValue;
}
var isCloning = false;
function skipDuringClone(callback, fallback = () => {
}) {
  return (...args) => isCloning ? fallback(...args) : callback(...args);
}
function onlyDuringClone(callback) {
  return (...args) => isCloning && callback(...args);
}
var interceptors = [];
function interceptClone(callback) {
  interceptors.push(callback);
}
function cloneNode(from, to) {
  interceptors.forEach((i) => i(from, to));
  isCloning = true;
  dontRegisterReactiveSideEffects(() => {
    initTree(to, (el, callback) => {
      callback(el, () => {
      });
    });
  });
  isCloning = false;
}
var isCloningLegacy = false;
function clone(oldEl, newEl) {
  if (!newEl._x_dataStack)
    newEl._x_dataStack = oldEl._x_dataStack;
  isCloning = true;
  isCloningLegacy = true;
  dontRegisterReactiveSideEffects(() => {
    cloneTree(newEl);
  });
  isCloning = false;
  isCloningLegacy = false;
}
function cloneTree(el) {
  let hasRunThroughFirstEl = false;
  let shallowWalker = (el2, callback) => {
    walk(el2, (el3, skip) => {
      if (hasRunThroughFirstEl && isRoot(el3))
        return skip();
      hasRunThroughFirstEl = true;
      callback(el3, skip);
    });
  };
  initTree(el, shallowWalker);
}
function dontRegisterReactiveSideEffects(callback) {
  let cache = effect;
  overrideEffect((callback2, el) => {
    let storedEffect = cache(callback2);
    release(storedEffect);
    return () => {
    };
  });
  callback();
  overrideEffect(cache);
}
function bind(el, name, value, modifiers = []) {
  if (!el._x_bindings)
    el._x_bindings = reactive({});
  el._x_bindings[name] = value;
  name = modifiers.includes("camel") ? camelCase(name) : name;
  switch (name) {
    case "value":
      bindInputValue(el, value);
      break;
    case "style":
      bindStyles(el, value);
      break;
    case "class":
      bindClasses(el, value);
      break;
    case "selected":
    case "checked":
      bindAttributeAndProperty(el, name, value);
      break;
    default:
      bindAttribute(el, name, value);
      break;
  }
}
function bindInputValue(el, value) {
  if (isRadio(el)) {
    if (el.attributes.value === void 0) {
      el.value = value;
    }
    if (window.fromModel) {
      if (typeof value === "boolean") {
        el.checked = safeParseBoolean(el.value) === value;
      } else {
        el.checked = checkedAttrLooseCompare(el.value, value);
      }
    }
  } else if (isCheckbox(el)) {
    if (Number.isInteger(value)) {
      el.value = value;
    } else if (!Array.isArray(value) && typeof value !== "boolean" && ![null, void 0].includes(value)) {
      el.value = String(value);
    } else {
      if (Array.isArray(value)) {
        el.checked = value.some((val) => checkedAttrLooseCompare(val, el.value));
      } else {
        el.checked = !!value;
      }
    }
  } else if (el.tagName === "SELECT") {
    updateSelect(el, value);
  } else {
    if (el.value === value)
      return;
    el.value = value === void 0 ? "" : value;
  }
}
function bindClasses(el, value) {
  if (el._x_undoAddedClasses)
    el._x_undoAddedClasses();
  el._x_undoAddedClasses = setClasses(el, value);
}
function bindStyles(el, value) {
  if (el._x_undoAddedStyles)
    el._x_undoAddedStyles();
  el._x_undoAddedStyles = setStyles(el, value);
}
function bindAttributeAndProperty(el, name, value) {
  bindAttribute(el, name, value);
  setPropertyIfChanged(el, name, value);
}
function bindAttribute(el, name, value) {
  if ([null, void 0, false].includes(value) && attributeShouldntBePreservedIfFalsy(name)) {
    el.removeAttribute(name);
  } else {
    if (isBooleanAttr(name))
      value = name;
    setIfChanged(el, name, value);
  }
}
function setIfChanged(el, attrName, value) {
  if (el.getAttribute(attrName) != value) {
    el.setAttribute(attrName, value);
  }
}
function setPropertyIfChanged(el, propName, value) {
  if (el[propName] !== value) {
    el[propName] = value;
  }
}
function updateSelect(el, value) {
  const arrayWrappedValue = [].concat(value).map((value2) => {
    return value2 + "";
  });
  Array.from(el.options).forEach((option) => {
    option.selected = arrayWrappedValue.includes(option.value);
  });
}
function camelCase(subject) {
  return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
}
function checkedAttrLooseCompare(valueA, valueB) {
  return valueA == valueB;
}
function safeParseBoolean(rawValue) {
  if ([1, "1", "true", "on", "yes", true].includes(rawValue)) {
    return true;
  }
  if ([0, "0", "false", "off", "no", false].includes(rawValue)) {
    return false;
  }
  return rawValue ? Boolean(rawValue) : null;
}
var booleanAttributes = /* @__PURE__ */ new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
  "shadowrootclonable",
  "shadowrootdelegatesfocus",
  "shadowrootserializable"
]);
function isBooleanAttr(attrName) {
  return booleanAttributes.has(attrName);
}
function attributeShouldntBePreservedIfFalsy(name) {
  return !["aria-pressed", "aria-checked", "aria-expanded", "aria-selected"].includes(name);
}
function getBinding(el, name, fallback) {
  if (el._x_bindings && el._x_bindings[name] !== void 0)
    return el._x_bindings[name];
  return getAttributeBinding(el, name, fallback);
}
function extractProp(el, name, fallback, extract = true) {
  if (el._x_bindings && el._x_bindings[name] !== void 0)
    return el._x_bindings[name];
  if (el._x_inlineBindings && el._x_inlineBindings[name] !== void 0) {
    let binding = el._x_inlineBindings[name];
    binding.extract = extract;
    return dontAutoEvaluateFunctions(() => {
      return evaluate(el, binding.expression);
    });
  }
  return getAttributeBinding(el, name, fallback);
}
function getAttributeBinding(el, name, fallback) {
  let attr = el.getAttribute(name);
  if (attr === null)
    return typeof fallback === "function" ? fallback() : fallback;
  if (attr === "")
    return true;
  if (isBooleanAttr(name)) {
    return !![name, "true"].includes(attr);
  }
  return attr;
}
function isCheckbox(el) {
  return el.type === "checkbox" || el.localName === "ui-checkbox" || el.localName === "ui-switch";
}
function isRadio(el) {
  return el.type === "radio" || el.localName === "ui-radio";
}
function debounce(func, wait) {
  var timeout;
  return function() {
    var context = this, args = arguments;
    var later = function() {
      timeout = null;
      func.apply(context, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
function throttle(func, limit) {
  let inThrottle;
  return function() {
    let context = this, args = arguments;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
function entangle({ get: outerGet, set: outerSet }, { get: innerGet, set: innerSet }) {
  let firstRun = true;
  let outerHash;
  let reference = effect(() => {
    let outer = outerGet();
    let inner = innerGet();
    if (firstRun) {
      innerSet(cloneIfObject(outer));
      firstRun = false;
    } else {
      let outerHashLatest = JSON.stringify(outer);
      let innerHashLatest = JSON.stringify(inner);
      if (outerHashLatest !== outerHash) {
        innerSet(cloneIfObject(outer));
      } else if (outerHashLatest !== innerHashLatest) {
        outerSet(cloneIfObject(inner));
      } else ;
    }
    outerHash = JSON.stringify(outerGet());
    JSON.stringify(innerGet());
  });
  return () => {
    release(reference);
  };
}
function cloneIfObject(value) {
  return typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}
function plugin(callback) {
  let callbacks = Array.isArray(callback) ? callback : [callback];
  callbacks.forEach((i) => i(alpine_default));
}
var stores = {};
var isReactive = false;
function store(name, value) {
  if (!isReactive) {
    stores = reactive(stores);
    isReactive = true;
  }
  if (value === void 0) {
    return stores[name];
  }
  stores[name] = value;
  initInterceptors(stores[name]);
  if (typeof value === "object" && value !== null && value.hasOwnProperty("init") && typeof value.init === "function") {
    stores[name].init();
  }
}
function getStores() {
  return stores;
}
var binds = {};
function bind2(name, bindings) {
  let getBindings = typeof bindings !== "function" ? () => bindings : bindings;
  if (name instanceof Element) {
    return applyBindingsObject(name, getBindings());
  } else {
    binds[name] = getBindings;
  }
  return () => {
  };
}
function injectBindingProviders(obj) {
  Object.entries(binds).forEach(([name, callback]) => {
    Object.defineProperty(obj, name, {
      get() {
        return (...args) => {
          return callback(...args);
        };
      }
    });
  });
  return obj;
}
function applyBindingsObject(el, obj, original) {
  let cleanupRunners = [];
  while (cleanupRunners.length)
    cleanupRunners.pop()();
  let attributes = Object.entries(obj).map(([name, value]) => ({ name, value }));
  let staticAttributes = attributesOnly(attributes);
  attributes = attributes.map((attribute) => {
    if (staticAttributes.find((attr) => attr.name === attribute.name)) {
      return {
        name: `x-bind:${attribute.name}`,
        value: `"${attribute.value}"`
      };
    }
    return attribute;
  });
  directives(el, attributes, original).map((handle) => {
    cleanupRunners.push(handle.runCleanups);
    handle();
  });
  return () => {
    while (cleanupRunners.length)
      cleanupRunners.pop()();
  };
}
var datas = {};
function data(name, callback) {
  datas[name] = callback;
}
function injectDataProviders(obj, context) {
  Object.entries(datas).forEach(([name, callback]) => {
    Object.defineProperty(obj, name, {
      get() {
        return (...args) => {
          return callback.bind(context)(...args);
        };
      },
      enumerable: false
    });
  });
  return obj;
}
var Alpine = {
  get reactive() {
    return reactive;
  },
  get release() {
    return release;
  },
  get effect() {
    return effect;
  },
  get raw() {
    return raw;
  },
  version: "3.14.9",
  flushAndStopDeferringMutations,
  dontAutoEvaluateFunctions,
  disableEffectScheduling,
  startObservingMutations,
  stopObservingMutations,
  setReactivityEngine,
  onAttributeRemoved,
  onAttributesAdded,
  closestDataStack,
  skipDuringClone,
  onlyDuringClone,
  addRootSelector,
  addInitSelector,
  interceptClone,
  addScopeToNode,
  deferMutations,
  mapAttributes,
  evaluateLater,
  interceptInit,
  setEvaluator,
  mergeProxies,
  extractProp,
  findClosest,
  onElRemoved,
  closestRoot,
  destroyTree,
  interceptor,
  // INTERNAL: not public API and is subject to change without major release.
  transition,
  // INTERNAL
  setStyles,
  // INTERNAL
  mutateDom,
  directive,
  entangle,
  throttle,
  debounce,
  evaluate,
  initTree,
  nextTick,
  prefixed: prefix,
  prefix: setPrefix,
  plugin,
  magic,
  store,
  start,
  clone,
  // INTERNAL
  cloneNode,
  // INTERNAL
  bound: getBinding,
  $data: scope,
  watch,
  walk,
  data,
  bind: bind2
};
var alpine_default = Alpine;
function makeMap(str, expectsLowerCase) {
  const map = /* @__PURE__ */ Object.create(null);
  const list = str.split(",");
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true;
  }
  return (val) => !!map[val];
}
var EMPTY_OBJ = Object.freeze({});
var hasOwnProperty = Object.prototype.hasOwnProperty;
var hasOwn = (val, key) => hasOwnProperty.call(val, key);
var isArray = Array.isArray;
var isMap = (val) => toTypeString(val) === "[object Map]";
var isString = (val) => typeof val === "string";
var isSymbol = (val) => typeof val === "symbol";
var isObject = (val) => val !== null && typeof val === "object";
var objectToString = Object.prototype.toString;
var toTypeString = (value) => objectToString.call(value);
var toRawType = (value) => {
  return toTypeString(value).slice(8, -1);
};
var isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
var cacheStringFunction = (fn) => {
  const cache = /* @__PURE__ */ Object.create(null);
  return (str) => {
    const hit = cache[str];
    return hit || (cache[str] = fn(str));
  };
};
var capitalize = cacheStringFunction((str) => str.charAt(0).toUpperCase() + str.slice(1));
var hasChanged = (value, oldValue) => value !== oldValue && (value === value || oldValue === oldValue);
var targetMap = /* @__PURE__ */ new WeakMap();
var effectStack = [];
var activeEffect;
var ITERATE_KEY = Symbol("iterate");
var MAP_KEY_ITERATE_KEY = Symbol("Map key iterate");
function isEffect(fn) {
  return fn && fn._isEffect === true;
}
function effect2(fn, options = EMPTY_OBJ) {
  if (isEffect(fn)) {
    fn = fn.raw;
  }
  const effect3 = createReactiveEffect(fn, options);
  if (!options.lazy) {
    effect3();
  }
  return effect3;
}
function stop(effect3) {
  if (effect3.active) {
    cleanup(effect3);
    if (effect3.options.onStop) {
      effect3.options.onStop();
    }
    effect3.active = false;
  }
}
var uid = 0;
function createReactiveEffect(fn, options) {
  const effect3 = function reactiveEffect() {
    if (!effect3.active) {
      return fn();
    }
    if (!effectStack.includes(effect3)) {
      cleanup(effect3);
      try {
        enableTracking();
        effectStack.push(effect3);
        activeEffect = effect3;
        return fn();
      } finally {
        effectStack.pop();
        resetTracking();
        activeEffect = effectStack[effectStack.length - 1];
      }
    }
  };
  effect3.id = uid++;
  effect3.allowRecurse = !!options.allowRecurse;
  effect3._isEffect = true;
  effect3.active = true;
  effect3.raw = fn;
  effect3.deps = [];
  effect3.options = options;
  return effect3;
}
function cleanup(effect3) {
  const { deps } = effect3;
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect3);
    }
    deps.length = 0;
  }
}
var shouldTrack = true;
var trackStack = [];
function pauseTracking() {
  trackStack.push(shouldTrack);
  shouldTrack = false;
}
function enableTracking() {
  trackStack.push(shouldTrack);
  shouldTrack = true;
}
function resetTracking() {
  const last = trackStack.pop();
  shouldTrack = last === void 0 ? true : last;
}
function track(target, type, key) {
  if (!shouldTrack || activeEffect === void 0) {
    return;
  }
  let depsMap = targetMap.get(target);
  if (!depsMap) {
    targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
  }
  let dep = depsMap.get(key);
  if (!dep) {
    depsMap.set(key, dep = /* @__PURE__ */ new Set());
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    activeEffect.deps.push(dep);
    if (activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      });
    }
  }
}
function trigger(target, type, key, newValue, oldValue, oldTarget) {
  const depsMap = targetMap.get(target);
  if (!depsMap) {
    return;
  }
  const effects = /* @__PURE__ */ new Set();
  const add2 = (effectsToAdd) => {
    if (effectsToAdd) {
      effectsToAdd.forEach((effect3) => {
        if (effect3 !== activeEffect || effect3.allowRecurse) {
          effects.add(effect3);
        }
      });
    }
  };
  if (type === "clear") {
    depsMap.forEach(add2);
  } else if (key === "length" && isArray(target)) {
    depsMap.forEach((dep, key2) => {
      if (key2 === "length" || key2 >= newValue) {
        add2(dep);
      }
    });
  } else {
    if (key !== void 0) {
      add2(depsMap.get(key));
    }
    switch (type) {
      case "add":
        if (!isArray(target)) {
          add2(depsMap.get(ITERATE_KEY));
          if (isMap(target)) {
            add2(depsMap.get(MAP_KEY_ITERATE_KEY));
          }
        } else if (isIntegerKey(key)) {
          add2(depsMap.get("length"));
        }
        break;
      case "delete":
        if (!isArray(target)) {
          add2(depsMap.get(ITERATE_KEY));
          if (isMap(target)) {
            add2(depsMap.get(MAP_KEY_ITERATE_KEY));
          }
        }
        break;
      case "set":
        if (isMap(target)) {
          add2(depsMap.get(ITERATE_KEY));
        }
        break;
    }
  }
  const run = (effect3) => {
    if (effect3.options.onTrigger) {
      effect3.options.onTrigger({
        effect: effect3,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      });
    }
    if (effect3.options.scheduler) {
      effect3.options.scheduler(effect3);
    } else {
      effect3();
    }
  };
  effects.forEach(run);
}
var isNonTrackableKeys = /* @__PURE__ */ makeMap(`__proto__,__v_isRef,__isVue`);
var builtInSymbols = new Set(Object.getOwnPropertyNames(Symbol).map((key) => Symbol[key]).filter(isSymbol));
var get2 = /* @__PURE__ */ createGetter();
var readonlyGet = /* @__PURE__ */ createGetter(true);
var arrayInstrumentations = /* @__PURE__ */ createArrayInstrumentations();
function createArrayInstrumentations() {
  const instrumentations = {};
  ["includes", "indexOf", "lastIndexOf"].forEach((key) => {
    instrumentations[key] = function(...args) {
      const arr = toRaw(this);
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, "get", i + "");
      }
      const res = arr[key](...args);
      if (res === -1 || res === false) {
        return arr[key](...args.map(toRaw));
      } else {
        return res;
      }
    };
  });
  ["push", "pop", "shift", "unshift", "splice"].forEach((key) => {
    instrumentations[key] = function(...args) {
      pauseTracking();
      const res = toRaw(this)[key].apply(this, args);
      resetTracking();
      return res;
    };
  });
  return instrumentations;
}
function createGetter(isReadonly = false, shallow = false) {
  return function get3(target, key, receiver) {
    if (key === "__v_isReactive") {
      return !isReadonly;
    } else if (key === "__v_isReadonly") {
      return isReadonly;
    } else if (key === "__v_raw" && receiver === (isReadonly ? shallow ? shallowReadonlyMap : readonlyMap : shallow ? shallowReactiveMap : reactiveMap).get(target)) {
      return target;
    }
    const targetIsArray = isArray(target);
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver);
    }
    const res = Reflect.get(target, key, receiver);
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res;
    }
    if (!isReadonly) {
      track(target, "get", key);
    }
    if (shallow) {
      return res;
    }
    if (isRef(res)) {
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key);
      return shouldUnwrap ? res.value : res;
    }
    if (isObject(res)) {
      return isReadonly ? readonly(res) : reactive2(res);
    }
    return res;
  };
}
var set2 = /* @__PURE__ */ createSetter();
function createSetter(shallow = false) {
  return function set3(target, key, value, receiver) {
    let oldValue = target[key];
    if (!shallow) {
      value = toRaw(value);
      oldValue = toRaw(oldValue);
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value;
        return true;
      }
    }
    const hadKey = isArray(target) && isIntegerKey(key) ? Number(key) < target.length : hasOwn(target, key);
    const result = Reflect.set(target, key, value, receiver);
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, "add", key, value);
      } else if (hasChanged(value, oldValue)) {
        trigger(target, "set", key, value, oldValue);
      }
    }
    return result;
  };
}
function deleteProperty(target, key) {
  const hadKey = hasOwn(target, key);
  const oldValue = target[key];
  const result = Reflect.deleteProperty(target, key);
  if (result && hadKey) {
    trigger(target, "delete", key, void 0, oldValue);
  }
  return result;
}
function has(target, key) {
  const result = Reflect.has(target, key);
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, "has", key);
  }
  return result;
}
function ownKeys(target) {
  track(target, "iterate", isArray(target) ? "length" : ITERATE_KEY);
  return Reflect.ownKeys(target);
}
var mutableHandlers = {
  get: get2,
  set: set2,
  deleteProperty,
  has,
  ownKeys
};
var readonlyHandlers = {
  get: readonlyGet,
  set(target, key) {
    {
      console.warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
    }
    return true;
  },
  deleteProperty(target, key) {
    {
      console.warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
    }
    return true;
  }
};
var toReactive = (value) => isObject(value) ? reactive2(value) : value;
var toReadonly = (value) => isObject(value) ? readonly(value) : value;
var toShallow = (value) => value;
var getProto = (v) => Reflect.getPrototypeOf(v);
function get$1(target, key, isReadonly = false, isShallow = false) {
  target = target[
    "__v_raw"
    /* RAW */
  ];
  const rawTarget = toRaw(target);
  const rawKey = toRaw(key);
  if (key !== rawKey) {
    !isReadonly && track(rawTarget, "get", key);
  }
  !isReadonly && track(rawTarget, "get", rawKey);
  const { has: has2 } = getProto(rawTarget);
  const wrap2 = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
  if (has2.call(rawTarget, key)) {
    return wrap2(target.get(key));
  } else if (has2.call(rawTarget, rawKey)) {
    return wrap2(target.get(rawKey));
  } else if (target !== rawTarget) {
    target.get(key);
  }
}
function has$1(key, isReadonly = false) {
  const target = this[
    "__v_raw"
    /* RAW */
  ];
  const rawTarget = toRaw(target);
  const rawKey = toRaw(key);
  if (key !== rawKey) {
    !isReadonly && track(rawTarget, "has", key);
  }
  !isReadonly && track(rawTarget, "has", rawKey);
  return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
}
function size(target, isReadonly = false) {
  target = target[
    "__v_raw"
    /* RAW */
  ];
  !isReadonly && track(toRaw(target), "iterate", ITERATE_KEY);
  return Reflect.get(target, "size", target);
}
function add(value) {
  value = toRaw(value);
  const target = toRaw(this);
  const proto = getProto(target);
  const hadKey = proto.has.call(target, value);
  if (!hadKey) {
    target.add(value);
    trigger(target, "add", value, value);
  }
  return this;
}
function set$1(key, value) {
  value = toRaw(value);
  const target = toRaw(this);
  const { has: has2, get: get3 } = getProto(target);
  let hadKey = has2.call(target, key);
  if (!hadKey) {
    key = toRaw(key);
    hadKey = has2.call(target, key);
  } else {
    checkIdentityKeys(target, has2, key);
  }
  const oldValue = get3.call(target, key);
  target.set(key, value);
  if (!hadKey) {
    trigger(target, "add", key, value);
  } else if (hasChanged(value, oldValue)) {
    trigger(target, "set", key, value, oldValue);
  }
  return this;
}
function deleteEntry(key) {
  const target = toRaw(this);
  const { has: has2, get: get3 } = getProto(target);
  let hadKey = has2.call(target, key);
  if (!hadKey) {
    key = toRaw(key);
    hadKey = has2.call(target, key);
  } else {
    checkIdentityKeys(target, has2, key);
  }
  const oldValue = get3 ? get3.call(target, key) : void 0;
  const result = target.delete(key);
  if (hadKey) {
    trigger(target, "delete", key, void 0, oldValue);
  }
  return result;
}
function clear() {
  const target = toRaw(this);
  const hadItems = target.size !== 0;
  const oldTarget = isMap(target) ? new Map(target) : new Set(target);
  const result = target.clear();
  if (hadItems) {
    trigger(target, "clear", void 0, void 0, oldTarget);
  }
  return result;
}
function createForEach(isReadonly, isShallow) {
  return function forEach(callback, thisArg) {
    const observed = this;
    const target = observed[
      "__v_raw"
      /* RAW */
    ];
    const rawTarget = toRaw(target);
    const wrap2 = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
    !isReadonly && track(rawTarget, "iterate", ITERATE_KEY);
    return target.forEach((value, key) => {
      return callback.call(thisArg, wrap2(value), wrap2(key), observed);
    });
  };
}
function createIterableMethod(method, isReadonly, isShallow) {
  return function(...args) {
    const target = this[
      "__v_raw"
      /* RAW */
    ];
    const rawTarget = toRaw(target);
    const targetIsMap = isMap(rawTarget);
    const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
    const isKeyOnly = method === "keys" && targetIsMap;
    const innerIterator = target[method](...args);
    const wrap2 = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
    !isReadonly && track(rawTarget, "iterate", isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY);
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next();
        return done ? { value, done } : {
          value: isPair ? [wrap2(value[0]), wrap2(value[1])] : wrap2(value),
          done
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function createReadonlyMethod(type) {
  return function(...args) {
    {
      const key = args[0] ? `on key "${args[0]}" ` : ``;
      console.warn(`${capitalize(type)} operation ${key}failed: target is readonly.`, toRaw(this));
    }
    return type === "delete" ? false : this;
  };
}
function createInstrumentations() {
  const mutableInstrumentations2 = {
    get(key) {
      return get$1(this, key);
    },
    get size() {
      return size(this);
    },
    has: has$1,
    add,
    set: set$1,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, false)
  };
  const shallowInstrumentations2 = {
    get(key) {
      return get$1(this, key, false, true);
    },
    get size() {
      return size(this);
    },
    has: has$1,
    add,
    set: set$1,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, true)
  };
  const readonlyInstrumentations2 = {
    get(key) {
      return get$1(this, key, true);
    },
    get size() {
      return size(this, true);
    },
    has(key) {
      return has$1.call(this, key, true);
    },
    add: createReadonlyMethod(
      "add"
      /* ADD */
    ),
    set: createReadonlyMethod(
      "set"
      /* SET */
    ),
    delete: createReadonlyMethod(
      "delete"
      /* DELETE */
    ),
    clear: createReadonlyMethod(
      "clear"
      /* CLEAR */
    ),
    forEach: createForEach(true, false)
  };
  const shallowReadonlyInstrumentations2 = {
    get(key) {
      return get$1(this, key, true, true);
    },
    get size() {
      return size(this, true);
    },
    has(key) {
      return has$1.call(this, key, true);
    },
    add: createReadonlyMethod(
      "add"
      /* ADD */
    ),
    set: createReadonlyMethod(
      "set"
      /* SET */
    ),
    delete: createReadonlyMethod(
      "delete"
      /* DELETE */
    ),
    clear: createReadonlyMethod(
      "clear"
      /* CLEAR */
    ),
    forEach: createForEach(true, true)
  };
  const iteratorMethods = ["keys", "values", "entries", Symbol.iterator];
  iteratorMethods.forEach((method) => {
    mutableInstrumentations2[method] = createIterableMethod(method, false, false);
    readonlyInstrumentations2[method] = createIterableMethod(method, true, false);
    shallowInstrumentations2[method] = createIterableMethod(method, false, true);
    shallowReadonlyInstrumentations2[method] = createIterableMethod(method, true, true);
  });
  return [
    mutableInstrumentations2,
    readonlyInstrumentations2,
    shallowInstrumentations2,
    shallowReadonlyInstrumentations2
  ];
}
var [mutableInstrumentations, readonlyInstrumentations, shallowInstrumentations, shallowReadonlyInstrumentations] = /* @__PURE__ */ createInstrumentations();
function createInstrumentationGetter(isReadonly, shallow) {
  const instrumentations = isReadonly ? readonlyInstrumentations : mutableInstrumentations;
  return (target, key, receiver) => {
    if (key === "__v_isReactive") {
      return !isReadonly;
    } else if (key === "__v_isReadonly") {
      return isReadonly;
    } else if (key === "__v_raw") {
      return target;
    }
    return Reflect.get(hasOwn(instrumentations, key) && key in target ? instrumentations : target, key, receiver);
  };
}
var mutableCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(false)
};
var readonlyCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(true)
};
function checkIdentityKeys(target, has2, key) {
  const rawKey = toRaw(key);
  if (rawKey !== key && has2.call(target, rawKey)) {
    const type = toRawType(target);
    console.warn(`Reactive ${type} contains both the raw and reactive versions of the same object${type === `Map` ? ` as keys` : ``}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`);
  }
}
var reactiveMap = /* @__PURE__ */ new WeakMap();
var shallowReactiveMap = /* @__PURE__ */ new WeakMap();
var readonlyMap = /* @__PURE__ */ new WeakMap();
var shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
function targetTypeMap(rawType) {
  switch (rawType) {
    case "Object":
    case "Array":
      return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return 2;
    default:
      return 0;
  }
}
function getTargetType(value) {
  return value[
    "__v_skip"
    /* SKIP */
  ] || !Object.isExtensible(value) ? 0 : targetTypeMap(toRawType(value));
}
function reactive2(target) {
  if (target && target[
    "__v_isReadonly"
    /* IS_READONLY */
  ]) {
    return target;
  }
  return createReactiveObject(target, false, mutableHandlers, mutableCollectionHandlers, reactiveMap);
}
function readonly(target) {
  return createReactiveObject(target, true, readonlyHandlers, readonlyCollectionHandlers, readonlyMap);
}
function createReactiveObject(target, isReadonly, baseHandlers, collectionHandlers, proxyMap) {
  if (!isObject(target)) {
    {
      console.warn(`value cannot be made reactive: ${String(target)}`);
    }
    return target;
  }
  if (target[
    "__v_raw"
    /* RAW */
  ] && !(isReadonly && target[
    "__v_isReactive"
    /* IS_REACTIVE */
  ])) {
    return target;
  }
  const existingProxy = proxyMap.get(target);
  if (existingProxy) {
    return existingProxy;
  }
  const targetType = getTargetType(target);
  if (targetType === 0) {
    return target;
  }
  const proxy = new Proxy(target, targetType === 2 ? collectionHandlers : baseHandlers);
  proxyMap.set(target, proxy);
  return proxy;
}
function toRaw(observed) {
  return observed && toRaw(observed[
    "__v_raw"
    /* RAW */
  ]) || observed;
}
function isRef(r) {
  return Boolean(r && r.__v_isRef === true);
}
magic("nextTick", () => nextTick);
magic("dispatch", (el) => dispatch.bind(dispatch, el));
magic("watch", (el, { evaluateLater: evaluateLater2, cleanup: cleanup2 }) => (key, callback) => {
  let evaluate2 = evaluateLater2(key);
  let getter = () => {
    let value;
    evaluate2((i) => value = i);
    return value;
  };
  let unwatch = watch(getter, callback);
  cleanup2(unwatch);
});
magic("store", getStores);
magic("data", (el) => scope(el));
magic("root", (el) => closestRoot(el));
magic("refs", (el) => {
  if (el._x_refs_proxy)
    return el._x_refs_proxy;
  el._x_refs_proxy = mergeProxies(getArrayOfRefObject(el));
  return el._x_refs_proxy;
});
function getArrayOfRefObject(el) {
  let refObjects = [];
  findClosest(el, (i) => {
    if (i._x_refs)
      refObjects.push(i._x_refs);
  });
  return refObjects;
}
var globalIdMemo = {};
function findAndIncrementId(name) {
  if (!globalIdMemo[name])
    globalIdMemo[name] = 0;
  return ++globalIdMemo[name];
}
function closestIdRoot(el, name) {
  return findClosest(el, (element) => {
    if (element._x_ids && element._x_ids[name])
      return true;
  });
}
function setIdRoot(el, name) {
  if (!el._x_ids)
    el._x_ids = {};
  if (!el._x_ids[name])
    el._x_ids[name] = findAndIncrementId(name);
}
magic("id", (el, { cleanup: cleanup2 }) => (name, key = null) => {
  let cacheKey = `${name}${key ? `-${key}` : ""}`;
  return cacheIdByNameOnElement(el, cacheKey, cleanup2, () => {
    let root = closestIdRoot(el, name);
    let id = root ? root._x_ids[name] : findAndIncrementId(name);
    return key ? `${name}-${id}-${key}` : `${name}-${id}`;
  });
});
interceptClone((from, to) => {
  if (from._x_id) {
    to._x_id = from._x_id;
  }
});
function cacheIdByNameOnElement(el, cacheKey, cleanup2, callback) {
  if (!el._x_id)
    el._x_id = {};
  if (el._x_id[cacheKey])
    return el._x_id[cacheKey];
  let output = callback();
  el._x_id[cacheKey] = output;
  cleanup2(() => {
    delete el._x_id[cacheKey];
  });
  return output;
}
magic("el", (el) => el);
warnMissingPluginMagic("Focus", "focus", "focus");
warnMissingPluginMagic("Persist", "persist", "persist");
function warnMissingPluginMagic(name, magicName, slug) {
  magic(magicName, (el) => warn(`You can't use [$${magicName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
}
directive("modelable", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2, cleanup: cleanup2 }) => {
  let func = evaluateLater2(expression);
  let innerGet = () => {
    let result;
    func((i) => result = i);
    return result;
  };
  let evaluateInnerSet = evaluateLater2(`${expression} = __placeholder`);
  let innerSet = (val) => evaluateInnerSet(() => {
  }, { scope: { "__placeholder": val } });
  let initialValue = innerGet();
  innerSet(initialValue);
  queueMicrotask(() => {
    if (!el._x_model)
      return;
    el._x_removeModelListeners["default"]();
    let outerGet = el._x_model.get;
    let outerSet = el._x_model.set;
    let releaseEntanglement = entangle(
      {
        get() {
          return outerGet();
        },
        set(value) {
          outerSet(value);
        }
      },
      {
        get() {
          return innerGet();
        },
        set(value) {
          innerSet(value);
        }
      }
    );
    cleanup2(releaseEntanglement);
  });
});
directive("teleport", (el, { modifiers, expression }, { cleanup: cleanup2 }) => {
  if (el.tagName.toLowerCase() !== "template")
    warn("x-teleport can only be used on a <template> tag", el);
  let target = getTarget(expression);
  let clone2 = el.content.cloneNode(true).firstElementChild;
  el._x_teleport = clone2;
  clone2._x_teleportBack = el;
  el.setAttribute("data-teleport-template", true);
  clone2.setAttribute("data-teleport-target", true);
  if (el._x_forwardEvents) {
    el._x_forwardEvents.forEach((eventName) => {
      clone2.addEventListener(eventName, (e) => {
        e.stopPropagation();
        el.dispatchEvent(new e.constructor(e.type, e));
      });
    });
  }
  addScopeToNode(clone2, {}, el);
  let placeInDom = (clone3, target2, modifiers2) => {
    if (modifiers2.includes("prepend")) {
      target2.parentNode.insertBefore(clone3, target2);
    } else if (modifiers2.includes("append")) {
      target2.parentNode.insertBefore(clone3, target2.nextSibling);
    } else {
      target2.appendChild(clone3);
    }
  };
  mutateDom(() => {
    placeInDom(clone2, target, modifiers);
    skipDuringClone(() => {
      initTree(clone2);
    })();
  });
  el._x_teleportPutBack = () => {
    let target2 = getTarget(expression);
    mutateDom(() => {
      placeInDom(el._x_teleport, target2, modifiers);
    });
  };
  cleanup2(
    () => mutateDom(() => {
      clone2.remove();
      destroyTree(clone2);
    })
  );
});
var teleportContainerDuringClone = document.createElement("div");
function getTarget(expression) {
  let target = skipDuringClone(() => {
    return document.querySelector(expression);
  }, () => {
    return teleportContainerDuringClone;
  })();
  if (!target)
    warn(`Cannot find x-teleport element for selector: "${expression}"`);
  return target;
}
var handler = () => {
};
handler.inline = (el, { modifiers }, { cleanup: cleanup2 }) => {
  modifiers.includes("self") ? el._x_ignoreSelf = true : el._x_ignore = true;
  cleanup2(() => {
    modifiers.includes("self") ? delete el._x_ignoreSelf : delete el._x_ignore;
  });
};
directive("ignore", handler);
directive("effect", skipDuringClone((el, { expression }, { effect: effect3 }) => {
  effect3(evaluateLater(el, expression));
}));
function on(el, event, modifiers, callback) {
  let listenerTarget = el;
  let handler4 = (e) => callback(e);
  let options = {};
  let wrapHandler = (callback2, wrapper) => (e) => wrapper(callback2, e);
  if (modifiers.includes("dot"))
    event = dotSyntax(event);
  if (modifiers.includes("camel"))
    event = camelCase2(event);
  if (modifiers.includes("passive"))
    options.passive = true;
  if (modifiers.includes("capture"))
    options.capture = true;
  if (modifiers.includes("window"))
    listenerTarget = window;
  if (modifiers.includes("document"))
    listenerTarget = document;
  if (modifiers.includes("debounce")) {
    let nextModifier = modifiers[modifiers.indexOf("debounce") + 1] || "invalid-wait";
    let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
    handler4 = debounce(handler4, wait);
  }
  if (modifiers.includes("throttle")) {
    let nextModifier = modifiers[modifiers.indexOf("throttle") + 1] || "invalid-wait";
    let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
    handler4 = throttle(handler4, wait);
  }
  if (modifiers.includes("prevent"))
    handler4 = wrapHandler(handler4, (next, e) => {
      e.preventDefault();
      next(e);
    });
  if (modifiers.includes("stop"))
    handler4 = wrapHandler(handler4, (next, e) => {
      e.stopPropagation();
      next(e);
    });
  if (modifiers.includes("once")) {
    handler4 = wrapHandler(handler4, (next, e) => {
      next(e);
      listenerTarget.removeEventListener(event, handler4, options);
    });
  }
  if (modifiers.includes("away") || modifiers.includes("outside")) {
    listenerTarget = document;
    handler4 = wrapHandler(handler4, (next, e) => {
      if (el.contains(e.target))
        return;
      if (e.target.isConnected === false)
        return;
      if (el.offsetWidth < 1 && el.offsetHeight < 1)
        return;
      if (el._x_isShown === false)
        return;
      next(e);
    });
  }
  if (modifiers.includes("self"))
    handler4 = wrapHandler(handler4, (next, e) => {
      e.target === el && next(e);
    });
  if (isKeyEvent(event) || isClickEvent(event)) {
    handler4 = wrapHandler(handler4, (next, e) => {
      if (isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers)) {
        return;
      }
      next(e);
    });
  }
  listenerTarget.addEventListener(event, handler4, options);
  return () => {
    listenerTarget.removeEventListener(event, handler4, options);
  };
}
function dotSyntax(subject) {
  return subject.replace(/-/g, ".");
}
function camelCase2(subject) {
  return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
}
function isNumeric(subject) {
  return !Array.isArray(subject) && !isNaN(subject);
}
function kebabCase2(subject) {
  if ([" ", "_"].includes(
    subject
  ))
    return subject;
  return subject.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]/, "-").toLowerCase();
}
function isKeyEvent(event) {
  return ["keydown", "keyup"].includes(event);
}
function isClickEvent(event) {
  return ["contextmenu", "click", "mouse"].some((i) => event.includes(i));
}
function isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers) {
  let keyModifiers = modifiers.filter((i) => {
    return !["window", "document", "prevent", "stop", "once", "capture", "self", "away", "outside", "passive"].includes(i);
  });
  if (keyModifiers.includes("debounce")) {
    let debounceIndex = keyModifiers.indexOf("debounce");
    keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
  }
  if (keyModifiers.includes("throttle")) {
    let debounceIndex = keyModifiers.indexOf("throttle");
    keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
  }
  if (keyModifiers.length === 0)
    return false;
  if (keyModifiers.length === 1 && keyToModifiers(e.key).includes(keyModifiers[0]))
    return false;
  const systemKeyModifiers = ["ctrl", "shift", "alt", "meta", "cmd", "super"];
  const selectedSystemKeyModifiers = systemKeyModifiers.filter((modifier) => keyModifiers.includes(modifier));
  keyModifiers = keyModifiers.filter((i) => !selectedSystemKeyModifiers.includes(i));
  if (selectedSystemKeyModifiers.length > 0) {
    const activelyPressedKeyModifiers = selectedSystemKeyModifiers.filter((modifier) => {
      if (modifier === "cmd" || modifier === "super")
        modifier = "meta";
      return e[`${modifier}Key`];
    });
    if (activelyPressedKeyModifiers.length === selectedSystemKeyModifiers.length) {
      if (isClickEvent(e.type))
        return false;
      if (keyToModifiers(e.key).includes(keyModifiers[0]))
        return false;
    }
  }
  return true;
}
function keyToModifiers(key) {
  if (!key)
    return [];
  key = kebabCase2(key);
  let modifierToKeyMap = {
    "ctrl": "control",
    "slash": "/",
    "space": " ",
    "spacebar": " ",
    "cmd": "meta",
    "esc": "escape",
    "up": "arrow-up",
    "down": "arrow-down",
    "left": "arrow-left",
    "right": "arrow-right",
    "period": ".",
    "comma": ",",
    "equal": "=",
    "minus": "-",
    "underscore": "_"
  };
  modifierToKeyMap[key] = key;
  return Object.keys(modifierToKeyMap).map((modifier) => {
    if (modifierToKeyMap[modifier] === key)
      return modifier;
  }).filter((modifier) => modifier);
}
directive("model", (el, { modifiers, expression }, { effect: effect3, cleanup: cleanup2 }) => {
  let scopeTarget = el;
  if (modifiers.includes("parent")) {
    scopeTarget = el.parentNode;
  }
  let evaluateGet = evaluateLater(scopeTarget, expression);
  let evaluateSet;
  if (typeof expression === "string") {
    evaluateSet = evaluateLater(scopeTarget, `${expression} = __placeholder`);
  } else if (typeof expression === "function" && typeof expression() === "string") {
    evaluateSet = evaluateLater(scopeTarget, `${expression()} = __placeholder`);
  } else {
    evaluateSet = () => {
    };
  }
  let getValue = () => {
    let result;
    evaluateGet((value) => result = value);
    return isGetterSetter(result) ? result.get() : result;
  };
  let setValue = (value) => {
    let result;
    evaluateGet((value2) => result = value2);
    if (isGetterSetter(result)) {
      result.set(value);
    } else {
      evaluateSet(() => {
      }, {
        scope: { "__placeholder": value }
      });
    }
  };
  if (typeof expression === "string" && el.type === "radio") {
    mutateDom(() => {
      if (!el.hasAttribute("name"))
        el.setAttribute("name", expression);
    });
  }
  var event = el.tagName.toLowerCase() === "select" || ["checkbox", "radio"].includes(el.type) || modifiers.includes("lazy") ? "change" : "input";
  let removeListener = isCloning ? () => {
  } : on(el, event, modifiers, (e) => {
    setValue(getInputValue(el, modifiers, e, getValue()));
  });
  if (modifiers.includes("fill")) {
    if ([void 0, null, ""].includes(getValue()) || isCheckbox(el) && Array.isArray(getValue()) || el.tagName.toLowerCase() === "select" && el.multiple) {
      setValue(
        getInputValue(el, modifiers, { target: el }, getValue())
      );
    }
  }
  if (!el._x_removeModelListeners)
    el._x_removeModelListeners = {};
  el._x_removeModelListeners["default"] = removeListener;
  cleanup2(() => el._x_removeModelListeners["default"]());
  if (el.form) {
    let removeResetListener = on(el.form, "reset", [], (e) => {
      nextTick(() => el._x_model && el._x_model.set(getInputValue(el, modifiers, { target: el }, getValue())));
    });
    cleanup2(() => removeResetListener());
  }
  el._x_model = {
    get() {
      return getValue();
    },
    set(value) {
      setValue(value);
    }
  };
  el._x_forceModelUpdate = (value) => {
    if (value === void 0 && typeof expression === "string" && expression.match(/\./))
      value = "";
    window.fromModel = true;
    mutateDom(() => bind(el, "value", value));
    delete window.fromModel;
  };
  effect3(() => {
    let value = getValue();
    if (modifiers.includes("unintrusive") && document.activeElement.isSameNode(el))
      return;
    el._x_forceModelUpdate(value);
  });
});
function getInputValue(el, modifiers, event, currentValue) {
  return mutateDom(() => {
    if (event instanceof CustomEvent && event.detail !== void 0)
      return event.detail !== null && event.detail !== void 0 ? event.detail : event.target.value;
    else if (isCheckbox(el)) {
      if (Array.isArray(currentValue)) {
        let newValue = null;
        if (modifiers.includes("number")) {
          newValue = safeParseNumber(event.target.value);
        } else if (modifiers.includes("boolean")) {
          newValue = safeParseBoolean(event.target.value);
        } else {
          newValue = event.target.value;
        }
        return event.target.checked ? currentValue.includes(newValue) ? currentValue : currentValue.concat([newValue]) : currentValue.filter((el2) => !checkedAttrLooseCompare2(el2, newValue));
      } else {
        return event.target.checked;
      }
    } else if (el.tagName.toLowerCase() === "select" && el.multiple) {
      if (modifiers.includes("number")) {
        return Array.from(event.target.selectedOptions).map((option) => {
          let rawValue = option.value || option.text;
          return safeParseNumber(rawValue);
        });
      } else if (modifiers.includes("boolean")) {
        return Array.from(event.target.selectedOptions).map((option) => {
          let rawValue = option.value || option.text;
          return safeParseBoolean(rawValue);
        });
      }
      return Array.from(event.target.selectedOptions).map((option) => {
        return option.value || option.text;
      });
    } else {
      let newValue;
      if (isRadio(el)) {
        if (event.target.checked) {
          newValue = event.target.value;
        } else {
          newValue = currentValue;
        }
      } else {
        newValue = event.target.value;
      }
      if (modifiers.includes("number")) {
        return safeParseNumber(newValue);
      } else if (modifiers.includes("boolean")) {
        return safeParseBoolean(newValue);
      } else if (modifiers.includes("trim")) {
        return newValue.trim();
      } else {
        return newValue;
      }
    }
  });
}
function safeParseNumber(rawValue) {
  let number = rawValue ? parseFloat(rawValue) : null;
  return isNumeric2(number) ? number : rawValue;
}
function checkedAttrLooseCompare2(valueA, valueB) {
  return valueA == valueB;
}
function isNumeric2(subject) {
  return !Array.isArray(subject) && !isNaN(subject);
}
function isGetterSetter(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function";
}
directive("cloak", (el) => queueMicrotask(() => mutateDom(() => el.removeAttribute(prefix("cloak")))));
addInitSelector(() => `[${prefix("init")}]`);
directive("init", skipDuringClone((el, { expression }, { evaluate: evaluate2 }) => {
  if (typeof expression === "string") {
    return !!expression.trim() && evaluate2(expression, {}, false);
  }
  return evaluate2(expression, {}, false);
}));
directive("text", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
  let evaluate2 = evaluateLater2(expression);
  effect3(() => {
    evaluate2((value) => {
      mutateDom(() => {
        el.textContent = value;
      });
    });
  });
});
directive("html", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
  let evaluate2 = evaluateLater2(expression);
  effect3(() => {
    evaluate2((value) => {
      mutateDom(() => {
        el.innerHTML = value;
        el._x_ignoreSelf = true;
        initTree(el);
        delete el._x_ignoreSelf;
      });
    });
  });
});
mapAttributes(startingWith(":", into(prefix("bind:"))));
var handler2 = (el, { value, modifiers, expression, original }, { effect: effect3, cleanup: cleanup2 }) => {
  if (!value) {
    let bindingProviders = {};
    injectBindingProviders(bindingProviders);
    let getBindings = evaluateLater(el, expression);
    getBindings((bindings) => {
      applyBindingsObject(el, bindings, original);
    }, { scope: bindingProviders });
    return;
  }
  if (value === "key")
    return storeKeyForXFor(el, expression);
  if (el._x_inlineBindings && el._x_inlineBindings[value] && el._x_inlineBindings[value].extract) {
    return;
  }
  let evaluate2 = evaluateLater(el, expression);
  effect3(() => evaluate2((result) => {
    if (result === void 0 && typeof expression === "string" && expression.match(/\./)) {
      result = "";
    }
    mutateDom(() => bind(el, value, result, modifiers));
  }));
  cleanup2(() => {
    el._x_undoAddedClasses && el._x_undoAddedClasses();
    el._x_undoAddedStyles && el._x_undoAddedStyles();
  });
};
handler2.inline = (el, { value, modifiers, expression }) => {
  if (!value)
    return;
  if (!el._x_inlineBindings)
    el._x_inlineBindings = {};
  el._x_inlineBindings[value] = { expression, extract: false };
};
directive("bind", handler2);
function storeKeyForXFor(el, expression) {
  el._x_keyExpression = expression;
}
addRootSelector(() => `[${prefix("data")}]`);
directive("data", (el, { expression }, { cleanup: cleanup2 }) => {
  if (shouldSkipRegisteringDataDuringClone(el))
    return;
  expression = expression === "" ? "{}" : expression;
  let magicContext = {};
  injectMagics(magicContext, el);
  let dataProviderContext = {};
  injectDataProviders(dataProviderContext, magicContext);
  let data2 = evaluate(el, expression, { scope: dataProviderContext });
  if (data2 === void 0 || data2 === true)
    data2 = {};
  injectMagics(data2, el);
  let reactiveData = reactive(data2);
  initInterceptors(reactiveData);
  let undo = addScopeToNode(el, reactiveData);
  reactiveData["init"] && evaluate(el, reactiveData["init"]);
  cleanup2(() => {
    reactiveData["destroy"] && evaluate(el, reactiveData["destroy"]);
    undo();
  });
});
interceptClone((from, to) => {
  if (from._x_dataStack) {
    to._x_dataStack = from._x_dataStack;
    to.setAttribute("data-has-alpine-state", true);
  }
});
function shouldSkipRegisteringDataDuringClone(el) {
  if (!isCloning)
    return false;
  if (isCloningLegacy)
    return true;
  return el.hasAttribute("data-has-alpine-state");
}
directive("show", (el, { modifiers, expression }, { effect: effect3 }) => {
  let evaluate2 = evaluateLater(el, expression);
  if (!el._x_doHide)
    el._x_doHide = () => {
      mutateDom(() => {
        el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
      });
    };
  if (!el._x_doShow)
    el._x_doShow = () => {
      mutateDom(() => {
        if (el.style.length === 1 && el.style.display === "none") {
          el.removeAttribute("style");
        } else {
          el.style.removeProperty("display");
        }
      });
    };
  let hide = () => {
    el._x_doHide();
    el._x_isShown = false;
  };
  let show = () => {
    el._x_doShow();
    el._x_isShown = true;
  };
  let clickAwayCompatibleShow = () => setTimeout(show);
  let toggle = once(
    (value) => value ? show() : hide(),
    (value) => {
      if (typeof el._x_toggleAndCascadeWithTransitions === "function") {
        el._x_toggleAndCascadeWithTransitions(el, value, show, hide);
      } else {
        value ? clickAwayCompatibleShow() : hide();
      }
    }
  );
  let oldValue;
  let firstTime = true;
  effect3(() => evaluate2((value) => {
    if (!firstTime && value === oldValue)
      return;
    if (modifiers.includes("immediate"))
      value ? clickAwayCompatibleShow() : hide();
    toggle(value);
    oldValue = value;
    firstTime = false;
  }));
});
directive("for", (el, { expression }, { effect: effect3, cleanup: cleanup2 }) => {
  let iteratorNames = parseForExpression(expression);
  let evaluateItems = evaluateLater(el, iteratorNames.items);
  let evaluateKey = evaluateLater(
    el,
    // the x-bind:key expression is stored for our use instead of evaluated.
    el._x_keyExpression || "index"
  );
  el._x_prevKeys = [];
  el._x_lookup = {};
  effect3(() => loop(el, iteratorNames, evaluateItems, evaluateKey));
  cleanup2(() => {
    Object.values(el._x_lookup).forEach((el2) => mutateDom(
      () => {
        destroyTree(el2);
        el2.remove();
      }
    ));
    delete el._x_prevKeys;
    delete el._x_lookup;
  });
});
function loop(el, iteratorNames, evaluateItems, evaluateKey) {
  let isObject2 = (i) => typeof i === "object" && !Array.isArray(i);
  let templateEl = el;
  evaluateItems((items) => {
    if (isNumeric3(items) && items >= 0) {
      items = Array.from(Array(items).keys(), (i) => i + 1);
    }
    if (items === void 0)
      items = [];
    let lookup = el._x_lookup;
    let prevKeys = el._x_prevKeys;
    let scopes = [];
    let keys = [];
    if (isObject2(items)) {
      items = Object.entries(items).map(([key, value]) => {
        let scope2 = getIterationScopeVariables(iteratorNames, value, key, items);
        evaluateKey((value2) => {
          if (keys.includes(value2))
            warn("Duplicate key on x-for", el);
          keys.push(value2);
        }, { scope: { index: key, ...scope2 } });
        scopes.push(scope2);
      });
    } else {
      for (let i = 0; i < items.length; i++) {
        let scope2 = getIterationScopeVariables(iteratorNames, items[i], i, items);
        evaluateKey((value) => {
          if (keys.includes(value))
            warn("Duplicate key on x-for", el);
          keys.push(value);
        }, { scope: { index: i, ...scope2 } });
        scopes.push(scope2);
      }
    }
    let adds = [];
    let moves = [];
    let removes = [];
    let sames = [];
    for (let i = 0; i < prevKeys.length; i++) {
      let key = prevKeys[i];
      if (keys.indexOf(key) === -1)
        removes.push(key);
    }
    prevKeys = prevKeys.filter((key) => !removes.includes(key));
    let lastKey = "template";
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i];
      let prevIndex = prevKeys.indexOf(key);
      if (prevIndex === -1) {
        prevKeys.splice(i, 0, key);
        adds.push([lastKey, i]);
      } else if (prevIndex !== i) {
        let keyInSpot = prevKeys.splice(i, 1)[0];
        let keyForSpot = prevKeys.splice(prevIndex - 1, 1)[0];
        prevKeys.splice(i, 0, keyForSpot);
        prevKeys.splice(prevIndex, 0, keyInSpot);
        moves.push([keyInSpot, keyForSpot]);
      } else {
        sames.push(key);
      }
      lastKey = key;
    }
    for (let i = 0; i < removes.length; i++) {
      let key = removes[i];
      if (!(key in lookup))
        continue;
      mutateDom(() => {
        destroyTree(lookup[key]);
        lookup[key].remove();
      });
      delete lookup[key];
    }
    for (let i = 0; i < moves.length; i++) {
      let [keyInSpot, keyForSpot] = moves[i];
      let elInSpot = lookup[keyInSpot];
      let elForSpot = lookup[keyForSpot];
      let marker = document.createElement("div");
      mutateDom(() => {
        if (!elForSpot)
          warn(`x-for ":key" is undefined or invalid`, templateEl, keyForSpot, lookup);
        elForSpot.after(marker);
        elInSpot.after(elForSpot);
        elForSpot._x_currentIfEl && elForSpot.after(elForSpot._x_currentIfEl);
        marker.before(elInSpot);
        elInSpot._x_currentIfEl && elInSpot.after(elInSpot._x_currentIfEl);
        marker.remove();
      });
      elForSpot._x_refreshXForScope(scopes[keys.indexOf(keyForSpot)]);
    }
    for (let i = 0; i < adds.length; i++) {
      let [lastKey2, index] = adds[i];
      let lastEl = lastKey2 === "template" ? templateEl : lookup[lastKey2];
      if (lastEl._x_currentIfEl)
        lastEl = lastEl._x_currentIfEl;
      let scope2 = scopes[index];
      let key = keys[index];
      let clone2 = document.importNode(templateEl.content, true).firstElementChild;
      let reactiveScope = reactive(scope2);
      addScopeToNode(clone2, reactiveScope, templateEl);
      clone2._x_refreshXForScope = (newScope) => {
        Object.entries(newScope).forEach(([key2, value]) => {
          reactiveScope[key2] = value;
        });
      };
      mutateDom(() => {
        lastEl.after(clone2);
        skipDuringClone(() => initTree(clone2))();
      });
      if (typeof key === "object") {
        warn("x-for key cannot be an object, it must be a string or an integer", templateEl);
      }
      lookup[key] = clone2;
    }
    for (let i = 0; i < sames.length; i++) {
      lookup[sames[i]]._x_refreshXForScope(scopes[keys.indexOf(sames[i])]);
    }
    templateEl._x_prevKeys = keys;
  });
}
function parseForExpression(expression) {
  let forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
  let stripParensRE = /^\s*\(|\)\s*$/g;
  let forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/;
  let inMatch = expression.match(forAliasRE);
  if (!inMatch)
    return;
  let res = {};
  res.items = inMatch[2].trim();
  let item = inMatch[1].replace(stripParensRE, "").trim();
  let iteratorMatch = item.match(forIteratorRE);
  if (iteratorMatch) {
    res.item = item.replace(forIteratorRE, "").trim();
    res.index = iteratorMatch[1].trim();
    if (iteratorMatch[2]) {
      res.collection = iteratorMatch[2].trim();
    }
  } else {
    res.item = item;
  }
  return res;
}
function getIterationScopeVariables(iteratorNames, item, index, items) {
  let scopeVariables = {};
  if (/^\[.*\]$/.test(iteratorNames.item) && Array.isArray(item)) {
    let names = iteratorNames.item.replace("[", "").replace("]", "").split(",").map((i) => i.trim());
    names.forEach((name, i) => {
      scopeVariables[name] = item[i];
    });
  } else if (/^\{.*\}$/.test(iteratorNames.item) && !Array.isArray(item) && typeof item === "object") {
    let names = iteratorNames.item.replace("{", "").replace("}", "").split(",").map((i) => i.trim());
    names.forEach((name) => {
      scopeVariables[name] = item[name];
    });
  } else {
    scopeVariables[iteratorNames.item] = item;
  }
  if (iteratorNames.index)
    scopeVariables[iteratorNames.index] = index;
  if (iteratorNames.collection)
    scopeVariables[iteratorNames.collection] = items;
  return scopeVariables;
}
function isNumeric3(subject) {
  return !Array.isArray(subject) && !isNaN(subject);
}
function handler3() {
}
handler3.inline = (el, { expression }, { cleanup: cleanup2 }) => {
  let root = closestRoot(el);
  if (!root._x_refs)
    root._x_refs = {};
  root._x_refs[expression] = el;
  cleanup2(() => delete root._x_refs[expression]);
};
directive("ref", handler3);
directive("if", (el, { expression }, { effect: effect3, cleanup: cleanup2 }) => {
  if (el.tagName.toLowerCase() !== "template")
    warn("x-if can only be used on a <template> tag", el);
  let evaluate2 = evaluateLater(el, expression);
  let show = () => {
    if (el._x_currentIfEl)
      return el._x_currentIfEl;
    let clone2 = el.content.cloneNode(true).firstElementChild;
    addScopeToNode(clone2, {}, el);
    mutateDom(() => {
      el.after(clone2);
      skipDuringClone(() => initTree(clone2))();
    });
    el._x_currentIfEl = clone2;
    el._x_undoIf = () => {
      mutateDom(() => {
        destroyTree(clone2);
        clone2.remove();
      });
      delete el._x_currentIfEl;
    };
    return clone2;
  };
  let hide = () => {
    if (!el._x_undoIf)
      return;
    el._x_undoIf();
    delete el._x_undoIf;
  };
  effect3(() => evaluate2((value) => {
    value ? show() : hide();
  }));
  cleanup2(() => el._x_undoIf && el._x_undoIf());
});
directive("id", (el, { expression }, { evaluate: evaluate2 }) => {
  let names = evaluate2(expression);
  names.forEach((name) => setIdRoot(el, name));
});
interceptClone((from, to) => {
  if (from._x_ids) {
    to._x_ids = from._x_ids;
  }
});
mapAttributes(startingWith("@", into(prefix("on:"))));
directive("on", skipDuringClone((el, { value, modifiers, expression }, { cleanup: cleanup2 }) => {
  let evaluate2 = expression ? evaluateLater(el, expression) : () => {
  };
  if (el.tagName.toLowerCase() === "template") {
    if (!el._x_forwardEvents)
      el._x_forwardEvents = [];
    if (!el._x_forwardEvents.includes(value))
      el._x_forwardEvents.push(value);
  }
  let removeListener = on(el, value, modifiers, (e) => {
    evaluate2(() => {
    }, { scope: { "$event": e }, params: [e] });
  });
  cleanup2(() => removeListener());
}));
warnMissingPluginDirective("Collapse", "collapse", "collapse");
warnMissingPluginDirective("Intersect", "intersect", "intersect");
warnMissingPluginDirective("Focus", "trap", "focus");
warnMissingPluginDirective("Mask", "mask", "mask");
function warnMissingPluginDirective(name, directiveName, slug) {
  directive(directiveName, (el) => warn(`You can't use [x-${directiveName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
}
alpine_default.setEvaluator(normalEvaluator);
alpine_default.setReactivityEngine({ reactive: reactive2, effect: effect2, release: stop, raw: toRaw });
var src_default = alpine_default;
var module_default = src_default;
const instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
let idbProxyableTypes;
let cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
const cursorRequestMap = /* @__PURE__ */ new WeakMap();
const transactionDoneMap = /* @__PURE__ */ new WeakMap();
const transactionStoreNamesMap = /* @__PURE__ */ new WeakMap();
const transformCache = /* @__PURE__ */ new WeakMap();
const reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error2);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error2 = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error2);
  });
  promise.then((value) => {
    if (value instanceof IDBCursor) {
      cursorRequestMap.set(value, request);
    }
  }).catch(() => {
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error2);
      tx.removeEventListener("abort", error2);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error2 = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error2);
    tx.addEventListener("abort", error2);
  });
  transactionDoneMap.set(tx, done);
}
let idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "objectStoreNames") {
        return target.objectStoreNames || transactionStoreNamesMap.get(target);
      }
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (func === IDBDatabase.prototype.transaction && !("objectStoreNames" in IDBTransaction.prototype)) {
    return function(storeNames, ...args) {
      const tx = func.call(unwrap(this), storeNames, ...args);
      transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
      return wrap(tx);
    };
  }
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(cursorRequestMap.get(this));
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
const unwrap = (value) => reverseTransformCache.get(value);
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
const readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
const writeMethods = ["put", "add", "delete", "clear"];
const cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));
const DB_NAME = "not-the-news-db";
const DB_VERSION = 29;
let _dbInstance = null;
let _dbInitPromise = null;
const OBJECT_STORES_SCHEMA = [{
  name: "feedItems",
  keyPath: "id",
  options: { autoIncrement: true },
  indexes: [{ name: "guid", keyPath: "guid", options: { unique: true } }]
}, {
  name: "starred",
  keyPath: "id",
  options: { autoIncrement: true },
  indexes: [{ name: "guid", keyPath: "guid", options: { unique: true } }]
}, {
  name: "read",
  keyPath: "id",
  options: { autoIncrement: true },
  indexes: [{ name: "guid", keyPath: "guid", options: { unique: true } }]
}, {
  name: "currentDeckGuids",
  // NOTE: This store now holds full objects, not just GUIDs.
  keyPath: "id",
  options: { autoIncrement: true },
  indexes: [{ name: "guid", keyPath: "guid", options: { unique: true } }]
}, {
  name: "shuffledOutGuids",
  // NOTE: This store now holds full objects, not just GUIDs.
  keyPath: "id",
  options: { autoIncrement: true },
  indexes: [{ name: "guid", keyPath: "guid", options: { unique: true } }]
}, {
  name: "userSettings",
  // Standard key-value store.
  keyPath: "key"
}, {
  name: "pendingOperations",
  // Queue for offline operations.
  keyPath: "id",
  options: { autoIncrement: true }
}];
async function getDb() {
  if (_dbInstance) {
    return _dbInstance;
  }
  if (_dbInitPromise) {
    return _dbInitPromise;
  }
  _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      console.log(`[DB] Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
      const existingStores = new Set(db.objectStoreNames);
      OBJECT_STORES_SCHEMA.forEach((schema) => {
        let store2;
        if (existingStores.has(schema.name)) {
          db.deleteObjectStore(schema.name);
        }
        store2 = db.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
          ...schema.options || {}
        });
        console.log(`[DB] Created/Recreated store: ${schema.name}`);
        if (schema.indexes) {
          schema.indexes.forEach((index) => {
            store2.createIndex(index.name, index.keyPath, index.options || {});
            console.log(`[DB] Created index '${index.name}' on store '${schema.name}'`);
          });
        }
      });
    },
    blocked() {
      console.warn("[DB] Database upgrade blocked. Please close all other tabs with this site open.");
    },
    blocking() {
      console.warn("[DB] Database blocking other tabs.");
    }
  });
  try {
    _dbInstance = await _dbInitPromise;
    console.log(`[DB] Opened '${DB_NAME}', version ${DB_VERSION}`);
    return _dbInstance;
  } catch (e) {
    console.error(`[DB] Failed to open database '${DB_NAME}':`, e);
    _dbInstance = null;
    _dbInitPromise = null;
    throw e;
  }
}
async function withDb(callback) {
  let dbInstance = await getDb();
  return callback(dbInstance);
}
const isOnline = () => navigator.onLine;
const API_BASE_URL = window.location.origin;
async function _saveSyncMetaState(key, value) {
  return withDb(async (db) => {
    try {
      await db.put("userSettings", { key, value, lastModified: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (e) {
      console.error(`[DB] Failed to save sync metadata for key '${key}':`, e);
    }
  });
}
async function _addPendingOperationToBuffer(operation) {
  return withDb(async (db) => {
    const opToStore = { ...operation };
    if (opToStore.id) delete opToStore.id;
    try {
      const tx = db.transaction("pendingOperations", "readwrite");
      const id = await tx.store.add(opToStore);
      await tx.done;
      return id;
    } catch (e) {
      console.error("[DB] Error buffering operation:", e);
      throw e;
    }
  });
}
async function queueAndAttemptSyncOperation(operation) {
  if (!operation || typeof operation.type !== "string" || operation.type === "simpleUpdate" && (operation.value === null || operation.value === void 0)) {
    console.warn(`[DB] Skipping invalid or empty operation:`, operation);
    return;
  }
  try {
    const generatedId = await _addPendingOperationToBuffer(operation);
    console.log(`[DB] Operation buffered with ID: ${generatedId}`, operation);
    const { value: syncEnabled } = await loadSimpleState("syncEnabled");
    if (isOnline() && syncEnabled) {
      console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${generatedId}).`);
      const syncPayload = [{ ...operation, id: generatedId }];
      const response = await fetch(`${API_BASE_URL}/api/user-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncPayload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status} for immediate sync. Details: ${errorText}`);
      }
      const responseData = await response.json();
      const result = responseData.results?.find((res) => res.id === generatedId);
      if (result?.status === "success") {
        await withDb((db) => db.delete("pendingOperations", generatedId));
        console.log(`[DB] Successfully synced and removed immediate op ${generatedId} (${operation.type}).`);
        if (responseData.serverTime) await _saveSyncMetaState("lastStateSync", responseData.serverTime);
        pullUserState();
      } else {
        console.warn(`[DB] Immediate sync for op ${generatedId} reported non-success by server:`, result);
      }
    } else {
      console.log(`[DB] ${!isOnline() ? "Offline." : "Sync is disabled."} Buffering op ${generatedId} for later batch sync.`);
    }
  } catch (networkError) {
    console.error(`[DB] Network error during immediate sync for ${operation.type}. Will retry with batch sync.`, networkError);
  }
}
async function processPendingOperations() {
  const { value: syncEnabled } = await loadSimpleState("syncEnabled");
  if (!isOnline() || !syncEnabled) {
    console.log("[DB] Offline or sync is disabled. Skipping batch sync.");
    return;
  }
  const operations = await withDb((db) => db.getAll("pendingOperations")).catch((e) => {
    console.error("[DB] Error fetching pending operations:", e);
    return null;
  });
  if (!operations || operations.length === 0) {
    if (operations) console.log("[DB] No pending operations.");
    return;
  }
  console.log(`[DB] Sending ${operations.length} batched operations to /api/user-state.`);
  try {
    const response = await fetch(`${API_BASE_URL}/api/user-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operations)
    });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}. Details: ${await response.text()}`);
    }
    const responseData = await response.json();
    console.log("[DB] Batch sync successful. Server response:", responseData);
    if (responseData.results && Array.isArray(responseData.results)) {
      await withDb(async (db) => {
        const tx = db.transaction("pendingOperations", "readwrite");
        for (const result of responseData.results) {
          if (result.status === "success" && result.id !== void 0) {
            await tx.store.delete(result.id);
          } else {
            console.warn(`[DB] Op ${result.id ?? "N/A"} (${result.opType}) ${result.status}: ${result.reason || "N/A"}`);
          }
        }
        await tx.done;
      });
    } else {
      console.warn("[DB] Server response invalid; cannot clear buffered operations.");
    }
    if (responseData.serverTime) await _saveSyncMetaState("lastStateSync", responseData.serverTime);
    pullUserState();
  } catch (error2) {
    console.error("[DB] Error during batch synchronization:", error2);
  }
}
let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;
async function _pullSingleStateKey(key, def) {
  const allPendingOps = await withDb((db) => db.getAll("pendingOperations")).catch(() => []);
  const hasPendingOperations = allPendingOps.some(
    (op) => op.key === key || op.type === "starDelta" && key === "starred" || op.type === "readDelta" && key === "read" || op.type === "simpleUpdate" && op.key === "currentDeckGuids"
  );
  if (hasPendingOperations) {
    console.log(`[DB] Skipping pull for '${key}' because local changes are pending synchronization.`);
    return { key, status: "skipped_pending" };
  }
  const { value: localData, lastModified } = def.type === "array" ? await loadArrayState(def.store) : await loadSimpleState(key, def.store);
  const localTimestamp = lastModified || "";
  const headers = { "Content-Type": "application/json" };
  if (localTimestamp) headers["If-None-Match"] = localTimestamp;
  try {
    const response = await fetch(`${API_BASE_URL}/api/user-state/${key}`, { method: "GET", headers });
    if (response.status === 304) {
      return { key, status: 304, timestamp: localTimestamp };
    }
    if (!response.ok) {
      console.error(`[DB] HTTP error for ${key}: ${response.status}`);
      return { key, status: response.status };
    }
    const data2 = await response.json();
    console.log(`[DB] New data received for ${key}.`);
    if (def.type === "array") {
      const serverObjects = data2.value || [];
      const localObjects = localData || [];
      const serverGuids = new Set(serverObjects.map((item) => item.guid));
      const localGuids = new Set(localObjects.map((item) => item.guid));
      const objectsToAdd = serverObjects.filter((item) => !localGuids.has(item.guid));
      const objectsToRemove = localObjects.filter((item) => !serverGuids.has(item.guid));
      if (objectsToAdd.length > 0 || objectsToRemove.length > 0) {
        await withDb(async (db) => {
          const tx = db.transaction(def.store, "readwrite");
          for (const item of objectsToAdd) await tx.store.put(item);
          for (const item of objectsToRemove) await tx.store.delete(item.id);
          await tx.done;
        });
      }
    } else {
      await _saveSyncMetaState(key, data2.value);
    }
    return { key, status: 200, timestamp: data2.lastModified };
  } catch (error2) {
    console.error(`[DB] Failed to pull ${key}:`, error2);
    return { key, status: "error" };
  }
}
async function pullUserState() {
  const { value: syncEnabled } = await loadSimpleState("syncEnabled");
  if (!isOnline() || !syncEnabled) {
    if (syncEnabled) console.log("[DB] Offline. Skipping user state pull.");
    return;
  }
  if (_isPullingUserState) return;
  const now = Date.now();
  if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) return;
  _lastPullAttemptTime = now;
  _isPullingUserState = true;
  console.log("[DB] Pulling user state...");
  try {
    const keysToPull = Object.entries(USER_STATE_DEFS).filter(([, def]) => !def.localOnly);
    const results = await Promise.all(keysToPull.map(([key, def]) => _pullSingleStateKey(key, def)));
    const newestOverallTimestamp = results.reduce((newest, result) => {
      return result?.timestamp && result.timestamp > newest ? result.timestamp : newest;
    }, "");
    if (newestOverallTimestamp) await _saveSyncMetaState("lastStateSync", newestOverallTimestamp);
  } catch (error2) {
    console.error("[DB] User state pull failed:", error2);
  } finally {
    _isPullingUserState = false;
    console.log("[DB] User state pull completed.");
  }
}
async function getAllFeedItems() {
  return withDb((db) => db.getAll("feedItems")).catch((e) => {
    console.error("Failed to get all feed items:", e);
    return [];
  });
}
async function performFeedSync(app) {
  const { value: syncEnabled } = await loadSimpleState("syncEnabled");
  if (!isOnline() || !syncEnabled) {
    if (syncEnabled) console.log("[DB] Offline. Skipping feed sync.");
    return;
  }
  console.log("[DB] Fetching feed items from server.");
  try {
    const { value: lastFeedSyncTime } = await loadSimpleState("lastFeedSync");
    const response = await fetch(`${API_BASE_URL}/api/feed-guids?since=${lastFeedSyncTime || ""}`);
    if (response.status === 304) {
      console.log("[DB] Feed not modified.");
      return;
    }
    if (!response.ok) throw new Error(`HTTP error ${response.status} for /api/feed-guids`);
    const responseData = await response.json();
    console.log("[DB] /api/feed-guids response:", responseData);
    const { guids: serverGuidsList, serverTime } = responseData;
    const serverGuids = new Set(serverGuidsList);
    const localItems = await getAllFeedItems();
    const localGuids = new Set(localItems.map((item) => item.guid));
    const guidsToFetch = [...serverGuids].filter((guid) => !localGuids.has(guid));
    console.log(`[DB] GUIDs to fetch: ${guidsToFetch.length}`, guidsToFetch);
    const guidsToDelete = [...localGuids].filter((guid) => !serverGuids.has(guid));
    console.log(`[DB] New GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);
    if (guidsToFetch.length > 0) {
      const BATCH_SIZE = 50;
      const newItems = [];
      for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
        const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
        const itemsResponse = await fetch(`${API_BASE_URL}/api/feed-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guids: batch })
        });
        if (itemsResponse.ok) {
          const fetchedItems = await itemsResponse.json();
          console.log(`[DB] Fetched batch of ${fetchedItems.length} items:`, fetchedItems);
          newItems.push(...fetchedItems);
        } else {
          console.error(`[DB] Failed to fetch a batch of feed items. Status: ${itemsResponse.status}`);
        }
      }
      await withDb(async (db) => {
        const tx = db.transaction("feedItems", "readwrite");
        for (const item of newItems) if (item.guid) await tx.store.put(item);
        await tx.done;
      });
    }
    if (guidsToDelete.length > 0) {
      const guidToIdMap = new Map(localItems.map((item) => [item.guid, item.id]));
      await withDb(async (db) => {
        const tx = db.transaction("feedItems", "readwrite");
        for (const guid of guidsToDelete) {
          const id = guidToIdMap.get(guid);
          if (id !== void 0) await tx.store.delete(id);
        }
        await tx.done;
      });
    }
    if (serverTime) await _saveSyncMetaState("lastFeedSync", serverTime);
    app?.loadFeedItemsFromDB?.();
    app?.loadAndDisplayDeck?.();
    app?.updateCounts?.();
  } catch (error2) {
    console.error("[DB] Failed to synchronize feed:", error2);
  }
}
async function performFullSync(app) {
  const { value: syncEnabled } = await loadSimpleState("syncEnabled");
  if (!isOnline() || !syncEnabled) return;
  console.log("[DB] Full sync initiated.");
  try {
    await pullUserState();
    await performFeedSync(app);
    await processPendingOperations();
  } catch (error2) {
    console.error("[DB] Full sync failed:", error2);
  }
}
const USER_STATE_DEFS = {
  starred: { store: "starred", type: "array", localOnly: false, default: [] },
  read: { store: "read", type: "array", localOnly: false, default: [] },
  lastStateSync: { store: "userSettings", type: "simple", localOnly: false, default: 0 },
  lastFeedSync: { store: "userSettings", type: "simple", localOnly: true, default: 0 },
  openUrlsInNewTabEnabled: { store: "userSettings", type: "simple", localOnly: true, default: true },
  imagesEnabled: { store: "userSettings", type: "simple", localOnly: true, default: true },
  syncEnabled: { store: "userSettings", type: "simple", localOnly: true, default: true },
  currentDeckGuids: { store: "currentDeckGuids", type: "array", localOnly: false, default: [] },
  shuffledOutGuids: { store: "shuffledOutGuids", type: "array", localOnly: true, default: [] },
  feedLastModified: { store: "userSettings", type: "simple", localOnly: true, default: 0 }
};
async function loadSimpleState(key, storeName = "userSettings") {
  return withDb(async (db) => {
    try {
      const record = await db.get(storeName, key);
      return {
        value: record ? record.value : USER_STATE_DEFS[key]?.default || null,
        lastModified: record?.lastModified || null
      };
    } catch (e) {
      console.error(`Failed to load simple state for key '${key}':`, e);
      return { value: USER_STATE_DEFS[key]?.default || null, lastModified: null };
    }
  });
}
async function saveSimpleState(key, value, storeName = "userSettings") {
  await withDb((db) => db.put(storeName, { key, value, lastModified: (/* @__PURE__ */ new Date()).toISOString() }));
  const def = USER_STATE_DEFS[key];
  if (def && !def.localOnly) {
    await queueAndAttemptSyncOperation({
      type: "simpleUpdate",
      key,
      value,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
const getTimestampKey = (storeName) => {
  switch (storeName) {
    case "starred":
      return "starredAt";
    case "read":
      return "readAt";
    case "currentDeckGuids":
      return "addedAt";
    case "shuffledOutGuids":
      return "shuffledAt";
    default:
      return "updatedAt";
  }
};
async function loadArrayState(storeName) {
  console.log(`ENTERING loadArrayState for ${storeName}`);
  return withDb(async (db) => {
    try {
      const allItems = await db.getAll(storeName);
      const needsMigration = allItems.length > 0 && (typeof allItems[0] === "string" || allItems[0].id === void 0);
      if (needsMigration) {
        console.log(`[DB] Migration required for '${storeName}'.`);
        const timestampKey = getTimestampKey(storeName);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const uniqueItems = /* @__PURE__ */ new Map();
        allItems.forEach((item) => {
          const guid = typeof item === "string" ? item : item.guid;
          if (guid && !uniqueItems.has(guid)) {
            uniqueItems.set(guid, item);
          }
        });
        const deduplicatedItems = Array.from(uniqueItems.values());
        const migratedItems = deduplicatedItems.map((item) => ({
          guid: typeof item === "string" ? item : item.guid,
          [timestampKey]: now
        }));
        const tx = db.transaction(storeName, "readwrite");
        await tx.store.clear();
        for (const item of migratedItems) await tx.store.put(item);
        await tx.done;
        console.log(`[DB] Migration complete for '${storeName}'.`);
        return { value: await db.getAll(storeName) };
      }
      return { value: allItems || USER_STATE_DEFS[storeName]?.default || [] };
    } catch (e) {
      console.error(`Failed to load array state from store '${storeName}':`, e);
      return { value: USER_STATE_DEFS[storeName]?.default || [] };
    }
  });
}
async function updateArrayState(storeName, item, add2) {
  await withDb(async (db) => {
    const tx = db.transaction(storeName, "readwrite");
    if (!item || !item.guid) {
      console.error("[DB] updateArrayState requires an item with a guid property.", item);
      return;
    }
    const store2 = tx.objectStore(storeName);
    if (add2) {
      await store2.put(item);
    } else {
      const existingItem = await store2.index("guid").get(item.guid);
      if (existingItem?.id !== void 0) {
        await store2.delete(existingItem.id);
      }
    }
    await tx.done;
  });
  const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
  if (defEntry && !defEntry[1].localOnly) {
    let opType = "";
    if (storeName === "starred") opType = "starDelta";
    if (storeName === "read") opType = "readDelta";
    if (opType) {
      await queueAndAttemptSyncOperation({
        type: opType,
        guid: item.guid,
        action: add2 ? "add" : "remove",
        timestamp: item[getTimestampKey(storeName)] || (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
}
async function overwriteArrayAndSyncChanges(storeName, newObjects) {
  const { value: oldObjects } = await loadArrayState(storeName);
  const oldGuids = new Set(oldObjects.map((item) => item.guid));
  await saveArrayState(storeName, newObjects);
  const newGuids = new Set(newObjects.map((item) => item.guid));
  [...oldGuids].filter((guid) => !newGuids.has(guid));
  [...newGuids].filter((guid) => !newGuids.has(guid));
  const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
  if (!defEntry || defEntry[1].localOnly) return;
  return;
}
async function saveArrayState(storeName, objects) {
  return withDb(async (db) => {
    const tx = db.transaction(storeName, "readwrite");
    await tx.store.clear();
    for (const item of objects) {
      const sanitizedItem = JSON.parse(JSON.stringify(item));
      delete sanitizedItem.id;
      await tx.store.put(sanitizedItem);
    }
    await tx.done;
  });
}
const loadUserState = async (key) => {
  const response = await fetch(`/api/user-state/${key}`);
  if (!response.ok) {
    throw new Error(`Failed to load user state for key '${key}': ${response.status} ${response.statusText}`);
  }
  return response.json();
};
const saveUserState = async (key, value) => {
  const response = await fetch("/api/user-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ type: "simpleUpdate", key, value }])
  });
  if (!response.ok) {
    throw new Error(`Failed to save user state for key '${key}': ${response.status} ${response.statusText}`);
  }
  return response.json();
};
function formatDate(dateStr) {
  const now = /* @__PURE__ */ new Date();
  const date = new Date(dateStr);
  const secs = Math.floor((now.getTime() - date.getTime()) / 1e3);
  const TWO_WEEKS_SECS = 2 * 7 * 24 * 60 * 60;
  if (secs > TWO_WEEKS_SECS) {
    return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (secs < 60) return "Just now";
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function mapRawItem(item, fmtFn) {
  if (!item) {
    console.warn("mapRawItem received an undefined or null item. Returning null.");
    return null;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(item.description || "", "text/html");
  const imgEl = doc.querySelector("img");
  const imgSrc = imgEl?.src || "";
  imgEl?.remove();
  let sourceUrl = "";
  const sourceEl = doc.querySelector(".source-url") || doc.querySelector("a");
  if (sourceEl) {
    sourceUrl = sourceEl.textContent?.trim() || "";
    sourceEl.remove();
  } else {
    sourceUrl = item.link ? new URL(item.link).hostname : "";
  }
  const descContent = doc.body.innerHTML.trim();
  const ts = Date.parse(item.pubDate) || 0;
  return {
    guid: item.guid,
    image: imgSrc,
    title: item.title,
    link: item.link,
    pubDate: fmtFn(item.pubDate || ""),
    description: descContent,
    source: sourceUrl,
    timestamp: ts
  };
}
function mapRawItems(rawList, fmtFn) {
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
  if (!Array.isArray(rawList)) {
    console.warn("mapRawItems received a non-array input. Returning empty array.");
    return [];
  }
  const mappedAndFiltered = rawList.map((item) => mapRawItem(item, fmtFn)).filter((item) => item !== null).sort((a, b) => b.timestamp - a.timestamp);
  console.log(`EXITING mapRawItems. Returning length: ${mappedAndFiltered.length}`);
  return mappedAndFiltered;
}
async function generateNewDeck(allFeedItems, readItems, starredItems, shuffledOutItems, filterMode) {
  console.log("ENTERING generateNewDeck");
  try {
    const MAX_DECK_SIZE = 10;
    const getGuidSet = (arr) => {
      if (!Array.isArray(arr)) {
        return /* @__PURE__ */ new Set();
      }
      const guids = arr.map((item) => typeof item === "object" && "guid" in item && item.guid ? item.guid : item);
      return new Set(guids.filter((guid) => typeof guid === "string" && Boolean(guid)));
    };
    const allFeedGuidsSet = new Set(allFeedItems.map((item) => item.guid));
    const readGuidsSet = new Set([...getGuidSet(readItems)].filter((guid) => allFeedGuidsSet.has(guid)));
    const starredGuidsSet = new Set([...getGuidSet(starredItems)].filter((guid) => allFeedGuidsSet.has(guid)));
    const shuffledOutGuidsSet = new Set([...getGuidSet(shuffledOutItems)].filter((guid) => allFeedGuidsSet.has(guid)));
    let filteredItems = [];
    console.log(`[generateNewDeck] Initial filteredItems count: ${filteredItems.length}`);
    switch (filterMode) {
      case "read":
        filteredItems = allFeedItems.filter((item) => readGuidsSet.has(item.guid));
        break;
      case "starred":
        filteredItems = allFeedItems.filter((item) => starredGuidsSet.has(item.guid));
        break;
      case "unread":
      default:
        filteredItems = allFeedItems.filter(
          (item) => !readGuidsSet.has(item.guid) && !shuffledOutGuidsSet.has(item.guid)
        );
        break;
    }
    if (filterMode === "read" || filterMode === "starred") {
      filteredItems.sort((a, b) => b.timestamp - a.timestamp);
      console.log(`[generateNewDeck] Filtered items for ${filterMode}: ${filteredItems.length}`);
      return filteredItems;
    }
    let nextDeckItems = [];
    const selectedIds = /* @__PURE__ */ new Set();
    const tryAddItemToDeck = (item) => {
      if (nextDeckItems.length < MAX_DECK_SIZE && item && !selectedIds.has(item.guid)) {
        nextDeckItems.push(item);
        selectedIds.add(item.guid);
        return true;
      }
      return false;
    };
    const addItemsFromCategory = (categoryItems, limit) => {
      let count = 0;
      for (const item of categoryItems) {
        if (count >= limit || nextDeckItems.length >= MAX_DECK_SIZE) break;
        if (tryAddItemToDeck(item)) count++;
      }
    };
    if (navigator.onLine) {
      const now = Date.now();
      const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
      const hasQuestionMarkInTitle = (item) => item.title?.includes("?");
      const hasQuestionMarkInDescriptionFirst150 = (item) => item.description?.length >= 150 && item.description.substring(0, 150).includes("?");
      const hasQuestionMarkInDescriptionLast150 = (item) => {
        const desc = item.description;
        return desc?.length >= 150 && desc.substring(desc.length - 150).includes("?");
      };
      const hasImage = (item) => item.image !== "";
      const isLongItem = (item) => item.description?.length >= 750;
      const isShortItem = (item) => item.description?.length < 750;
      const recentItems = filteredItems.filter((item) => now - item.timestamp <= 24 * 60 * 60 * 1e3);
      addItemsFromCategory(recentItems, 2);
      console.log(`[generateNewDeck] After recentItems: ${nextDeckItems.length}`);
      const itemsWithLinks = filteredItems.filter(hasHyperlink);
      addItemsFromCategory(itemsWithLinks, 1);
      console.log(`[generateNewDeck] After itemsWithLinks: ${nextDeckItems.length}`);
      const itemsWithQuestionTitle = filteredItems.filter(hasQuestionMarkInTitle);
      addItemsFromCategory(itemsWithQuestionTitle, 1);
      console.log(`[generateNewDeck] After itemsWithQuestionTitle: ${nextDeckItems.length}`);
      const itemsWithQuestionFirst150 = filteredItems.filter(hasQuestionMarkInDescriptionFirst150);
      addItemsFromCategory(itemsWithQuestionFirst150, 1);
      console.log(`[generateNewDeck] After itemsWithQuestionFirst150: ${nextDeckItems.length}`);
      const itemsWithQuestionLast150 = filteredItems.filter(hasQuestionMarkInDescriptionLast150);
      addItemsFromCategory(itemsWithQuestionLast150, 1);
      console.log(`[generateNewDeck] After itemsWithQuestionLast150: ${nextDeckItems.length}`);
      const itemsWithImages = filteredItems.filter(hasImage);
      addItemsFromCategory(itemsWithImages, 1);
      console.log(`[generateNewDeck] After itemsWithImages: ${nextDeckItems.length}`);
      const longItems = filteredItems.filter(isLongItem);
      addItemsFromCategory(longItems, 1);
      console.log(`[generateNewDeck] After longItems: ${nextDeckItems.length}`);
      const shortItems = filteredItems.filter(isShortItem);
      addItemsFromCategory(shortItems, 1);
      console.log(`[generateNewDeck] After shortItems: ${nextDeckItems.length}`);
      const trulyRemainingItems = filteredItems.filter((item) => !selectedIds.has(item.guid));
      const shuffledRemaining = shuffleArray([...trulyRemainingItems]);
      for (const item of shuffledRemaining) {
        if (nextDeckItems.length >= MAX_DECK_SIZE) break;
        tryAddItemToDeck(item);
      }
      console.log(`[generateNewDeck] After shuffledRemaining: ${nextDeckItems.length}`);
      if (nextDeckItems.length < MAX_DECK_SIZE) {
        const resurfaceCandidates = allFeedItems.filter(
          (item) => shuffledOutGuidsSet.has(item.guid) && !readGuidsSet.has(item.guid) && !selectedIds.has(item.guid)
        );
        resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp);
        for (const candidate of resurfaceCandidates) {
          if (nextDeckItems.length >= MAX_DECK_SIZE) break;
          tryAddItemToDeck(candidate);
        }
        console.log(`[generateNewDeck] After resurfaceCandidates: ${nextDeckItems.length}`);
        if (nextDeckItems.length < MAX_DECK_SIZE) {
          const remainingAllItems = allFeedItems.filter((item) => !selectedIds.has(item.guid));
          remainingAllItems.sort((a, b) => a.timestamp - b.timestamp);
          for (const item of remainingAllItems) {
            if (nextDeckItems.length >= MAX_DECK_SIZE) break;
            nextDeckItems.push(item);
            selectedIds.add(item.guid);
          }
          console.log(`[generateNewDeck] After remainingAllItems: ${nextDeckItems.length}`);
        }
      }
    } else {
      let offlineFilteredItems = [...filteredItems];
      const hasQuestionMarkInTitle = (item) => item.title?.includes("?");
      const hasQuestionMarkInDescriptionFirst150 = (item) => item.description?.length >= 150 && item.description.substring(0, 150).includes("?");
      const hasQuestionMarkInDescriptionLast150 = (item) => {
        const desc = item.description;
        return desc?.length >= 150 && desc.substring(desc.length - 150).includes("?");
      };
      const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
      const hasImage = (item) => item.image !== "";
      offlineFilteredItems = offlineFilteredItems.filter((item) => !hasQuestionMarkInTitle(item));
      offlineFilteredItems = offlineFilteredItems.filter((item) => !(item.description && hasQuestionMarkInDescriptionFirst150(item)));
      offlineFilteredItems = offlineFilteredItems.filter((item) => !(item.description && hasQuestionMarkInDescriptionLast150(item)));
      offlineFilteredItems = offlineFilteredItems.filter((item) => !hasHyperlink(item));
      offlineFilteredItems = offlineFilteredItems.filter((item) => !hasImage(item));
      if (offlineFilteredItems.length < 10) {
        let itemsToRestore = filteredItems.filter((item) => !offlineFilteredItems.includes(item));
        const restoreOrder = [
          (item) => hasImage(item),
          (item) => hasHyperlink(item),
          (item) => item.description && hasQuestionMarkInDescriptionLast150(item),
          (item) => item.description && hasQuestionMarkInDescriptionFirst150(item),
          (item) => hasQuestionMarkInTitle(item)
        ];
        for (const criterion of restoreOrder) {
          while (offlineFilteredItems.length < 10) {
            const itemToMove = itemsToRestore.find(criterion);
            if (itemToMove) {
              offlineFilteredItems.push(itemToMove);
              itemsToRestore = itemsToRestore.filter((i) => i !== itemToMove);
            } else {
              break;
            }
          }
          if (offlineFilteredItems.length >= 10) break;
        }
        while (offlineFilteredItems.length < 10 && itemsToRestore.length > 0) {
          offlineFilteredItems.push(itemsToRestore.shift());
        }
      }
      const now = Date.now();
      const recentItems = offlineFilteredItems.filter((item) => now - item.timestamp <= 24 * 60 * 60 * 1e3);
      nextDeckItems = recentItems.slice(0, 2);
      const remainingItems = offlineFilteredItems.filter((item) => !nextDeckItems.includes(item));
      nextDeckItems = nextDeckItems.concat(remainingItems.slice(0, 10 - nextDeckItems.length));
    }
    nextDeckItems.sort((a, b) => b.timestamp - a.timestamp);
    return nextDeckItems;
  } catch (error2) {
    console.error("An error occurred during deck generation:", error2);
    return [];
  }
}
const getSyncToggle = () => document.getElementById("sync-toggle");
const getImagesToggle = () => document.getElementById("images-toggle");
const getThemeToggle = () => document.getElementById("theme-toggle");
const getThemeText = () => document.getElementById("theme-text");
const getShuffleCountDisplay = () => document.getElementById("shuffle-count-display");
const getFilterSelector = () => document.getElementById("filter-selector");
const getNtnTitleH2 = () => document.querySelector("#ntn-title h2");
const getBackButton = () => document.getElementById("back-button");
const getRssFeedsTextarea = () => {
  const el = document.querySelector("#rss-settings-block textarea");
  console.log("[DEBUG] getRssFeedsTextarea called. Element:", el);
  return el;
};
const getKeywordsBlacklistTextarea = () => {
  const el = document.querySelector("#keywords-settings-block textarea");
  console.log("[DEBUG] getKeywordsBlacklistTextarea called. Element:", el);
  return el;
};
const getConfigureRssButton = () => document.getElementById("configure-rss-feeds-btn");
const getConfigureKeywordsButton = () => document.getElementById("configure-keyword-blacklist-btn");
const getSaveKeywordsButton = () => document.getElementById("save-keywords-btn");
const getSaveRssButton = () => document.getElementById("save-rss-btn");
function splitMessageIntoLines(message, maxCharsPerLine = 30) {
  const words = message.split(" ");
  let line1 = [];
  let line2 = [];
  let currentLineLength = 0;
  for (const word of words) {
    const wordLength = word.length + (line1.length > 0 ? 1 : 0);
    if (currentLineLength + wordLength <= maxCharsPerLine) {
      line1.push(word);
      currentLineLength += wordLength;
    } else {
      line2.push(word);
    }
  }
  return [line1.join(" "), line2.join(" ")].filter(Boolean);
}
async function displayTemporaryMessageInTitle(message) {
  const titleH2 = getNtnTitleH2();
  if (!titleH2) {
    console.warn("displayTemporaryMessageInTitle: 'ntn-title h2' element not found.");
    return;
  }
  const originalText = "NOT THE NEWS";
  const lines = splitMessageIntoLines(message);
  const originalOverflow = titleH2.style.overflow;
  titleH2.style.overflow = "visible";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (lines.length > 0) {
    titleH2.textContent = lines[0];
    await delay(1500);
  }
  if (lines.length > 1) {
    titleH2.textContent = lines.join(" ");
    await delay(1500);
  } else if (lines.length === 1) {
    await delay(1500);
  }
  titleH2.textContent = originalText;
  titleH2.style.overflow = originalOverflow;
}
let messageTimeoutId;
function createStatusBarMessage(app, message, type = "info") {
  clearTimeout(messageTimeoutId);
  app.syncStatusMessage = message;
  app.showSyncStatus = true;
  messageTimeoutId = setTimeout(() => {
    app.showSyncStatus = false;
    app.syncStatusMessage = "";
  }, 3e3);
}
function updateCounts(app) {
  if (!app?.entries?.length || !app.read || !app.starred || !app.currentDeckGuids) {
    console.warn("Attempted to update counts with an invalid app object. Skipping.");
    return;
  }
  const readSet = new Set(app.read.map((item) => item.guid));
  const starredSet = new Set(app.starred.map((item) => item.guid));
  const deckGuidsSet = new Set(app.currentDeckGuids.map((item) => item.guid));
  const entries = app.entries;
  const allC = entries.length;
  const readC = entries.filter((e) => readSet.has(e.guid)).length;
  const starredC = entries.filter((e) => starredSet.has(e.guid)).length;
  const unreadInDeckC = entries.filter((e) => deckGuidsSet.has(e.guid) && !readSet.has(e.guid)).length;
  const selector = getFilterSelector();
  if (!selector) return;
  const counts = { all: allC, read: readC, starred: starredC, unread: unreadInDeckC };
  Array.from(selector.options).forEach((opt) => {
    const filterName = opt.text.split(" ")[0];
    opt.text = `${filterName} (${counts[opt.value] ?? 0})`;
  });
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
const attachScrollToTopHandler = /* @__PURE__ */ (() => {
  let inactivityTimeout;
  let previousScrollPosition = 0;
  return (buttonId = "scroll-to-top") => {
    const button = document.getElementById(buttonId);
    if (!button) return;
    const handleScroll = () => {
      const currentScrollPosition = window.scrollY;
      button.classList.toggle("visible", currentScrollPosition < previousScrollPosition && currentScrollPosition > 0);
      previousScrollPosition = currentScrollPosition;
      clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => button.classList.remove("visible"), 2e3);
    };
    window.addEventListener("scroll", handleScroll);
    button.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToTop();
    });
  };
})();
async function saveCurrentScrollPosition() {
  let lastViewedItemId = "";
  let lastViewedItemOffset = 0;
  const entryElements = document.querySelectorAll(".entry[data-guid]");
  const firstVisibleEntry = Array.from(entryElements).find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom > 0;
  });
  if (firstVisibleEntry) {
    const rect = firstVisibleEntry.getBoundingClientRect();
    lastViewedItemId = firstVisibleEntry.dataset.guid || "";
    lastViewedItemOffset = rect.top;
  }
  await saveSimpleState("lastViewedItemId", lastViewedItemId);
  await saveSimpleState("lastViewedItemOffset", lastViewedItemOffset);
}
function sanitizeForIndexedDB(obj) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch (e) {
      console.error("structuredClone failed, falling back to manual sanitization.", e);
    }
  }
  const sanitized = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          sanitized[key] = value.map((item) => sanitizeForIndexedDB(item));
        } else {
          sanitized[key] = sanitizeForIndexedDB(value);
        }
      } else if (typeof value !== "function") {
        sanitized[key] = value;
      }
    }
  }
  return sanitized;
}
async function toggleItemStateAndSync(app, guid, stateKey) {
  const isCurrentlyActive = app[stateKey].some((item) => item.guid === guid);
  const action = isCurrentlyActive ? "remove" : "add";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const itemObject = stateKey === "read" ? { guid, readAt: timestamp } : { guid, starredAt: timestamp };
  await updateArrayState(stateKey, itemObject, action === "add");
  if (action === "add") {
    if (stateKey === "read") {
      app.read = [...app.read, itemObject];
    } else {
      app.starred = [...app.starred, itemObject];
    }
  } else {
    if (stateKey === "read") {
      app.read = app.read.filter((item) => item.guid !== guid);
    } else {
      app.starred = app.starred.filter((item) => item.guid !== guid);
    }
  }
  if (stateKey === "read") {
    createStatusBarMessage(app, isCurrentlyActive ? "Item unread." : "Item read.", "info");
  } else if (stateKey === "starred") {
    createStatusBarMessage(app, isCurrentlyActive ? "Item unstarred." : "Item starred.", "info");
  }
  if (typeof app.updateCounts === "function") app.updateCounts();
  const opType = `${stateKey}Delta`;
  const pendingOp = {
    type: opType,
    guid,
    action,
    timestamp
  };
  await queueAndAttemptSyncOperation(pendingOp);
}
async function pruneStaleRead(feedItems, readItems, currentTS) {
  if (!Array.isArray(readItems)) return [];
  if (!Array.isArray(feedItems) || feedItems.length === 0) return readItems;
  const validFeedGuids = new Set(feedItems.filter((e) => e && e.guid).map((e) => String(e.guid).trim().toLowerCase()));
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
  return readItems.filter((item) => {
    if (!item || !item.guid) return false;
    const normalizedGuid = String(item.guid).trim().toLowerCase();
    if (validFeedGuids.has(normalizedGuid)) return true;
    if (item.readAt) {
      const readAtTS = new Date(item.readAt).getTime();
      if (!isNaN(readAtTS)) {
        return currentTS - readAtTS < THIRTY_DAYS_MS;
      }
    }
    return true;
  });
}
async function loadAndPruneReadItems(feedItems) {
  const { value: rawItems } = await loadArrayState("read");
  let needsResave = false;
  let normalizedItems = [];
  if (Array.isArray(rawItems)) {
    const defaultTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    for (const item of rawItems) {
      if (typeof item === "string" && item) {
        normalizedItems.push({ guid: item, readAt: defaultTimestamp });
        needsResave = true;
      } else if (typeof item === "object" && item !== null && typeof item.guid === "string" && item.guid) {
        if (!item.readAt) {
          item.readAt = defaultTimestamp;
          needsResave = true;
        }
        normalizedItems.push(item);
      }
    }
  }
  const prunedItems = await pruneStaleRead(feedItems, normalizedItems, Date.now());
  if (prunedItems.length !== normalizedItems.length) {
    needsResave = true;
  }
  if (needsResave) {
    try {
      await saveArrayState("read", prunedItems);
      console.log(`Sanitized, pruned, or migrated read items. Original count: ${rawItems.length}, New count: ${prunedItems.length}`);
    } catch (error2) {
      console.error("Error saving pruned read items:", error2);
    }
  }
  return prunedItems;
}
async function loadCurrentDeck() {
  const { value: storedObjects } = await loadArrayState("currentDeckGuids");
  if (storedObjects && storedObjects.length > 0 && typeof storedObjects[0] === "string") {
    console.log("[loadCurrentDeck] Migrating legacy string-based deck data...");
    const defaultTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    const migratedObjects = storedObjects.map((guid) => ({ guid, addedAt: defaultTimestamp }));
    await saveArrayState("currentDeckGuids", migratedObjects);
    console.log(`[loadCurrentDeck] Migration complete. Loaded ${migratedObjects.length} objects.`);
    return migratedObjects;
  }
  const deckObjects = Array.isArray(storedObjects) ? storedObjects.filter((item) => typeof item === "object" && item !== null && typeof item.guid === "string" && item.guid) : [];
  console.log(`[loadCurrentDeck] Loaded ${deckObjects.length} deck objects.`);
  return deckObjects;
}
async function saveCurrentDeck(deckObjects) {
  if (!Array.isArray(deckObjects)) {
    console.error("[saveCurrentDeck] Invalid input: expected an array of objects.");
    return;
  }
  const validDeckObjects = deckObjects.filter((item) => typeof item === "object" && item !== null && typeof item.guid === "string" && item.guid);
  if (validDeckObjects.length !== deckObjects.length) {
    console.warn("[saveCurrentDeck] Filtered out invalid items from the generated deck.");
  }
  console.log("[saveCurrentDeck] Saving", validDeckObjects.length, "deck objects.");
  try {
    const sanitizedDeckObjects = validDeckObjects.map((item) => sanitizeForIndexedDB(item));
    await overwriteArrayAndSyncChanges("currentDeckGuids", sanitizedDeckObjects);
  } catch (e) {
    console.error("[saveCurrentDeck] An error occurred while saving the deck:", e);
  }
}
async function loadShuffleState() {
  const { value: shuffleCount } = await loadSimpleState("shuffleCount");
  const { value: lastShuffleResetDate } = await loadSimpleState("lastShuffleResetDate");
  return {
    shuffleCount: typeof shuffleCount === "number" ? shuffleCount : 2,
    lastShuffleResetDate: lastShuffleResetDate || (/* @__PURE__ */ new Date()).toDateString()
  };
}
async function saveShuffleState(count, resetDate) {
  await saveSimpleState("shuffleCount", count);
  await saveSimpleState("lastShuffleResetDate", resetDate);
  await queueAndAttemptSyncOperation({ type: "simpleUpdate", key: "shuffleCount", value: count, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  await queueAndAttemptSyncOperation({ type: "simpleUpdate", key: "lastShuffleResetDate", value: resetDate, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
}
async function setFilterMode(app, mode) {
  app.filterMode = mode;
  await saveSimpleState("filterMode", mode);
  await queueAndAttemptSyncOperation({ type: "simpleUpdate", key: "filterMode", value: mode, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
}
async function loadFilterMode() {
  const { value: mode } = await loadSimpleState("filterMode");
  return mode || "unread";
}
const userStateUtils = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loadAndPruneReadItems,
  loadCurrentDeck,
  loadFilterMode,
  loadShuffleState,
  pruneStaleRead,
  saveCurrentDeck,
  saveShuffleState,
  setFilterMode,
  toggleItemStateAndSync
}, Symbol.toStringTag, { value: "Module" }));
function dispatchAppDataReady() {
  document.dispatchEvent(new CustomEvent("app-data-ready", { bubbles: true }));
  console.log("Dispatched 'app-data-ready' event.");
}
async function setupBooleanToggle(app, getToggleEl, dbKey, onToggleCb = () => {
}) {
  const toggleEl = getToggleEl();
  if (!toggleEl) return;
  toggleEl.addEventListener("change", async () => {
    const newValue = app[dbKey];
    await saveSimpleState(dbKey, newValue);
    onToggleCb(newValue);
  });
}
async function initSyncToggle(app) {
  await setupBooleanToggle(app, getSyncToggle, "syncEnabled", async (enabled) => {
    app.updateSyncStatusMessage();
    if (enabled) {
      console.log("Sync enabled, triggering full sync.");
      await performFullSync(app);
      if (!app.currentDeckGuids?.length && app.entries?.length) {
        console.log("Deck is empty after sync. Rebuilding from all available items.");
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const readGuids = new Set(app.read.map((h) => h.guid));
        const shuffledOutGuids = new Set(app.shuffledOutItems.map((s) => s.guid));
        app.currentDeckGuids = app.entries.filter((item) => !readGuids.has(item.guid) && !shuffledOutGuids.has(item.guid)).map((item) => ({
          guid: item.guid,
          addedAt: now
        }));
        await saveArrayState("currentDeckGuids", app.currentDeckGuids);
        console.log(`Rebuilt deck with ${app.currentDeckGuids.length} items.`);
      }
      dispatchAppDataReady();
    }
  });
}
async function initImagesToggle(app) {
  await setupBooleanToggle(app, getImagesToggle, "imagesEnabled");
}
function initTheme(app) {
  const htmlEl = document.documentElement;
  const toggle = getThemeToggle();
  const text = getThemeText();
  if (!toggle || !text) return;
  const applyThemeUI = (theme) => {
    htmlEl.classList.remove("light", "dark");
    htmlEl.classList.add(theme);
    toggle.checked = theme === "dark";
    text.textContent = theme;
  };
  applyThemeUI(app.theme);
  toggle.addEventListener("change", async () => {
    const newTheme = toggle.checked ? "dark" : "light";
    app.theme = newTheme;
    applyThemeUI(newTheme);
    await saveSimpleState("theme", newTheme);
  });
}
async function setupTextareaPanel(key, viewName, getConfigButton, getTextarea, getSaveButton, app) {
  const configBtn = getConfigButton();
  const saveBtn = getSaveButton();
  if (!configBtn || !saveBtn) return;
  configBtn.addEventListener("click", async () => {
    let value;
    if (key === "rssFeeds" || key === "keywordBlacklist") {
      try {
        const response = await loadUserState(key);
        value = response.value;
      } catch (error2) {
        console.error(`Error loading ${key} from server:`, error2);
        value = key === "rssFeeds" ? "" : [];
      }
    } else {
      const result = await loadSimpleState(key);
      value = result.value;
    }
    let content;
    if (key === "rssFeeds" && value && typeof value === "object") {
      let allRssUrls = [];
      for (const category in value) {
        if (typeof value[category] === "object") {
          for (const subcategory in value[category]) {
            if (Array.isArray(value[category][subcategory])) {
              value[category][subcategory].forEach((feed) => {
                if (feed && feed.url) {
                  allRssUrls.push(feed.url);
                }
              });
            }
          }
        }
      }
      content = allRssUrls.join("\n");
    } else {
      content = Array.isArray(value) ? value.filter(Boolean).sort().join("\n") : value || "";
    }
    app[`${key}Input`] = content;
    app.modalView = viewName;
  });
  saveBtn.addEventListener("click", async () => {
    const textarea = getTextarea();
    const content = textarea?.value ?? app[`${key}Input`];
    const dataToSave = content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    try {
      if (key === "rssFeeds" || key === "keywordBlacklist") {
        await saveUserState(key, dataToSave);
      } else {
        await saveSimpleState(key, dataToSave);
      }
      app[`${key}Input`] = dataToSave.sort().join("\n");
      createStatusBarMessage(`${key} saved.`, "success");
    } catch (error2) {
      console.error(`Error saving ${key}:`, error2);
      createStatusBarMessage(`Failed to save ${key}: ${error2.message}`, "error");
    }
  });
}
async function initConfigPanelListeners(app) {
  const backBtn = getBackButton();
  backBtn?.addEventListener("click", () => {
    app.modalView = "main";
  });
  await setupTextareaPanel("rssFeeds", "rss", getConfigureRssButton, getRssFeedsTextarea, getSaveRssButton, app);
  await setupTextareaPanel("keywordBlacklist", "keywords", getConfigureKeywordsButton, getKeywordsBlacklistTextarea, getSaveKeywordsButton, app);
}
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installButton = document.getElementById("install-button");
  if (installButton) {
    installButton.style.display = "block";
    installButton.addEventListener("click", () => {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === "accepted") {
          console.log("PWA installed");
        } else {
          console.log("PWA installation dismissed");
        }
        deferredPrompt = null;
      });
    });
  }
});
const scriptRel = "modulepreload";
const assetsURL = function(dep) {
  return "/" + dep;
};
const seen = {};
const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (deps && deps.length > 0) {
    let allSettled = function(promises$2) {
      return Promise.all(promises$2.map((p) => Promise.resolve(p).then((value$1) => ({
        status: "fulfilled",
        value: value$1
      }), (reason) => ({
        status: "rejected",
        reason
      }))));
    };
    document.getElementsByTagName("link");
    const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
    const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
    promise = allSettled(deps.map((dep) => {
      dep = assetsURL(dep);
      if (dep in seen) return;
      seen[dep] = true;
      const isCss = dep.endsWith(".css");
      const cssSelector = isCss ? '[rel="stylesheet"]' : "";
      if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
      const link = document.createElement("link");
      link.rel = isCss ? "stylesheet" : scriptRel;
      if (!isCss) link.as = "script";
      link.crossOrigin = "";
      link.href = dep;
      if (cspNonce) link.setAttribute("nonce", cspNonce);
      document.head.appendChild(link);
      if (isCss) return new Promise((res, rej) => {
        link.addEventListener("load", res);
        link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));
      });
    }));
  }
  function handlePreloadError(err$2) {
    const e$1 = new Event("vite:preloadError", { cancelable: true });
    e$1.payload = err$2;
    window.dispatchEvent(e$1);
    if (!e$1.defaultPrevented) throw err$2;
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected") continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};
const DAILY_SHUFFLE_LIMIT = 2;
const getGuid = (item) => {
  if (typeof item === "object" && item.guid) {
    return item.guid;
  }
  return item;
};
const manageDailyDeck = async (entries, readItems, starredItems, shuffledOutItems, shuffleCount, filterMode = "unread", lastShuffleResetDate = null) => {
  console.log("manageDailyDeck: START");
  console.log("manageDailyDeck: Input params:", { entriesCount: entries.length, readItemsCount: readItems.length, starredItemsCount: starredItems.length, shuffledOutItemsCount: shuffledOutItems.length, shuffleCount, filterMode, lastShuffleResetDate });
  console.log("[deckManager] DEBUG: Array.isArray(entries):", Array.isArray(entries), "entries.length:", entries.length);
  console.log("[deckManager] DEBUG: Array.isArray(entries):", Array.isArray(entries), "entries.length:", entries.length);
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log("[deckManager] Skipping deck management: entries is empty.");
    console.log("manageDailyDeck: END (skipped)");
    return {
      deck: [],
      currentDeckGuids: [],
      shuffledOutGuids: Array.isArray(shuffledOutItems) ? shuffledOutItems : [],
      shuffleCount: typeof shuffleCount === "number" ? shuffleCount : DAILY_SHUFFLE_LIMIT,
      lastShuffleResetDate: typeof lastShuffleResetDate === "string" ? lastShuffleResetDate : (/* @__PURE__ */ new Date()).toDateString()
    };
  }
  const allItems = entries;
  const readItemsArray = Array.isArray(readItems) ? readItems : [];
  const starredItemsArray = Array.isArray(starredItems) ? starredItems : [];
  const shuffledOutItemsArray = Array.isArray(shuffledOutItems) ? shuffledOutItems : [];
  const { loadCurrentDeck: loadCurrentDeck2 } = await __vitePreload(async () => {
    const { loadCurrentDeck: loadCurrentDeck3 } = await Promise.resolve().then(() => userStateUtils);
    return { loadCurrentDeck: loadCurrentDeck3 };
  }, true ? void 0 : void 0);
  const currentDeckItems = await loadCurrentDeck2();
  console.log("manageDailyDeck: Loaded currentDeckItems count:", currentDeckItems.length);
  const readGuidsSet = new Set(readItemsArray.map(getGuid));
  const starredGuidsSet = new Set(starredItemsArray.map(getGuid));
  const today = (/* @__PURE__ */ new Date()).toDateString();
  const isNewDay = lastShuffleResetDate !== today;
  const isDeckEffectivelyEmpty = !currentDeckItems || currentDeckItems.length === 0 || currentDeckItems.every((item) => readGuidsSet.has(getGuid(item)));
  let newDeck = [];
  let newCurrentDeckGuids = currentDeckItems;
  let newShuffledOutGuids = shuffledOutItemsArray;
  let newShuffleCount = shuffleCount || DAILY_SHUFFLE_LIMIT;
  let newLastShuffleResetDate = lastShuffleResetDate || today;
  console.log("manageDailyDeck: Condition check:", { isNewDay, isDeckEffectivelyEmpty, filterModeIsNotUnread: filterMode !== "unread" });
  console.log("manageDailyDeck: isNewDay:", isNewDay);
  console.log("manageDailyDeck: isDeckEffectivelyEmpty:", isDeckEffectivelyEmpty);
  console.log("manageDailyDeck: filterMode:", filterMode);
  if (isNewDay || isDeckEffectivelyEmpty || filterMode !== "unread") {
    console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Deck Effectively Empty (${isDeckEffectivelyEmpty}), or Filter Mode Changed (${filterMode}).`);
    const newDeckItems = await generateNewDeck(
      allItems,
      readItemsArray,
      starredItemsArray,
      shuffledOutItemsArray,
      filterMode
    );
    console.log("manageDailyDeck: generateNewDeck returned count:", newDeckItems.length);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    newCurrentDeckGuids = (newDeckItems || []).map((item) => ({
      guid: item.guid,
      addedAt: timestamp
    }));
    newDeck = (newDeckItems || []).map((item) => ({
      ...item,
      isRead: readGuidsSet.has(item.guid),
      isStarred: starredGuidsSet.has(item.guid)
    }));
    await saveCurrentDeck(newCurrentDeckGuids);
    if (isNewDay) {
      newShuffledOutGuids = [];
      await saveArrayState("shuffledOutGuids", []);
      newShuffleCount = DAILY_SHUFFLE_LIMIT;
      await saveShuffleState(newShuffleCount, today);
      newLastShuffleResetDate = today;
      await saveSimpleState("lastShuffleResetDate", today);
    } else if (isDeckEffectivelyEmpty && filterMode === "unread") {
      newShuffleCount = Math.min(newShuffleCount + 1, DAILY_SHUFFLE_LIMIT);
      await saveShuffleState(newShuffleCount, lastShuffleResetDate ?? (/* @__PURE__ */ new Date()).toDateString());
    }
  }
  console.log(`[deckManager] Deck management complete. Final deck size: ${newDeck.length}.`);
  console.log("manageDailyDeck: END");
  return {
    deck: newDeck || [],
    currentDeckGuids: newCurrentDeckGuids || [],
    shuffledOutGuids: newShuffledOutGuids || [],
    shuffleCount: typeof newShuffleCount === "number" ? newShuffleCount : DAILY_SHUFFLE_LIMIT,
    lastShuffleResetDate: typeof newLastShuffleResetDate === "string" ? newLastShuffleResetDate : (/* @__PURE__ */ new Date()).toDateString()
  };
};
async function processShuffle(app) {
  console.log("[deckManager] processShuffle called.");
  if (app.shuffleCount <= 0) {
    createStatusBarMessage(app, "No shuffles left for today!", "error");
    return;
  }
  const visibleGuids = app.deck.map((item) => item.guid);
  const existingShuffledGuids = (app.shuffledOutGuids || []).map(getGuid).map((guid) => ({ guid, shuffledAt: (/* @__PURE__ */ new Date()).toISOString() }));
  const existingShuffledGuidsSet = new Set(existingShuffledGuids.map(getGuid));
  const updatedShuffledGuidsSet = /* @__PURE__ */ new Set([...existingShuffledGuidsSet, ...visibleGuids]);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const newShuffledOutGuids = Array.from(updatedShuffledGuidsSet).map((guid) => ({
    guid,
    shuffledAt: timestamp
  }));
  app.shuffledOutGuids = newShuffledOutGuids;
  app.shuffleCount--;
  await saveArrayState("shuffledOutGuids", newShuffledOutGuids);
  await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate ?? (/* @__PURE__ */ new Date()).toDateString());
  const shuffleDisplay = getShuffleCountDisplay();
  if (shuffleDisplay) {
    shuffleDisplay.textContent = app.shuffleCount.toString();
  }
  const result = await manageDailyDeck(
    app.entries,
    app.read,
    app.starred,
    app.shuffledOutGuids,
    app.shuffleCount,
    app.filterMode,
    app.lastShuffleResetDate
  );
  app.deck = result.deck;
  app.currentDeckGuids = result.currentDeckGuids;
  displayTemporaryMessageInTitle("Feed shuffled!");
  console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}
function rssApp() {
  return {
    // --- State Properties ---
    loading: true,
    progressMessage: "Initializing...",
    deck: [],
    feedItems: {},
    filterMode: "unread",
    openSettings: false,
    modalView: "main",
    shuffleCount: 0,
    syncEnabled: true,
    imagesEnabled: true,
    openUrlsInNewTabEnabled: true,
    rssFeedsInput: "",
    keywordBlacklistInput: "",
    read: [],
    starred: [],
    currentDeckGuids: [],
    shuffledOutItems: [],
    errorMessage: "",
    isOnline: isOnline(),
    deckManaged: false,
    syncStatusMessage: "",
    showSyncStatus: false,
    theme: "dark",
    rssSaveMessage: "",
    keywordSaveMessage: "",
    _lastFilterHash: "",
    _cachedFilteredEntries: null,
    scrollObserver: null,
    _initComplete: false,
    staleItemObserver: null,
    _isSyncing: false,
    // --- Core Methods ---
    initApp: async function() {
      try {
        console.log("Starting app initialization...");
        this.progressMessage = "Connecting to database...";
        this.db = await getDb();
        console.log("Database initialized");
        this.progressMessage = "Loading settings...";
        await this._loadInitialState();
        console.log("Initial state loaded");
        this.progressMessage = "Initializing UI components...";
        initTheme(this);
        initSyncToggle(this);
        initImagesToggle(this);
        this.$nextTick(() => {
          initConfigPanelListeners(this);
        });
        attachScrollToTopHandler();
        console.log("UI components initialized");
        this.progressMessage = "Loading existing data...";
        await this.loadFeedItemsFromDB();
        this.entries = mapRawItems(Object.values(this.feedItems), formatDate) || [];
        await this._loadAndManageAllData();
        this.updateAllUI();
        console.log("Initial UI rendered from local cache.");
        this.loading = false;
        this.progressMessage = "";
        console.log("App is visible. Proceeding with background sync.");
        console.log(`[Sync Check] Before conditional sync: isOnline=${this.isOnline}, syncEnabled=${this.syncEnabled}`);
        if (this.isOnline && this.syncEnabled) {
          console.log(`[Sync] isOnline: ${this.isOnline}, syncEnabled: ${this.syncEnabled}. Calling performBackgroundSync.`);
          await this.performBackgroundSync();
        }
        this._initComplete = true;
        window.appInitialized = true;
        this._setupWatchers();
        console.log("App initialization and background sync complete.");
        try {
          createStatusBarMessage("App ready", "success");
        } catch (statusError) {
          console.log("Status bar not ready yet, but initialization complete");
        }
        this.updateSyncStatusMessage();
      } catch (error2) {
        console.error("Initialization failed:", error2);
        this.errorMessage = `Could not load feed: ${error2.message}`;
        this.progressMessage = `Error: ${error2.message}`;
        this.loading = false;
      }
    },
    performBackgroundSync: async function() {
      console.log("[Sync] Entering performBackgroundSync.");
      console.log("[Sync] performBackgroundSync: _isSyncing:", this._isSyncing, "isOnline:", this.isOnline, "syncEnabled:", this.syncEnabled);
      if (this._isSyncing || !this.isOnline || !this.syncEnabled) return;
      this._isSyncing = true;
      console.log("[Sync] Starting background sync...");
      try {
        await processPendingOperations();
        await pullUserState();
        await performFeedSync(this);
        await this.loadFeedItemsFromDB();
        await this._reconcileAndRefreshUI();
        console.log("[Sync] Background sync completed successfully.");
      } catch (error2) {
        console.error("[Sync] Background sync failed:", error2);
        createStatusBarMessage("Background sync failed", "error");
      } finally {
        this._isSyncing = false;
      }
    },
    _reconcileAndRefreshUI: async function() {
      console.log("[UI] Reconciling UI after sync...");
      console.log("[UI] _reconcileAndRefreshUI params:", { deck: this.deck, read: this.read, starred: this.starred, shuffledOutItems: this.shuffledOutItems, shuffleCount: this.shuffleCount, filterMode: this.filterMode, lastShuffleResetDate: this.lastShuffleResetDate });
      this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
      this.starred = (await loadArrayState("starred")).value || [];
      const correctDeckResult = await manageDailyDeck(
        Array.from(this.entries),
        this.read,
        this.starred,
        this.shuffledOutItems,
        this.shuffleCount,
        this.filterMode,
        this.lastShuffleResetDate
      );
      console.log("[UI] correctDeckResult:", correctDeckResult);
      let correctDeck = [];
      if (correctDeckResult && correctDeckResult.deck) {
        correctDeck = correctDeckResult.deck;
      }
      console.log("[UI] correctDeck:", correctDeck);
      if (correctDeck && Array.isArray(correctDeck)) {
        new Set(correctDeck.map((item) => item.guid));
      }
      this.deck = correctDeck;
    },
    _initObservers: function() {
      this.staleItemObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            const guid = entry.target.dataset.guid;
            console.log(`[Observer] Stale item ${guid} is off-screen. Removing.`);
            this.deck = this.deck.filter((item) => item.guid !== guid);
            this.staleItemObserver.unobserve(entry.target);
          }
        });
      }, { root: null, threshold: 0 });
    },
    updateSyncStatusMessage: function() {
      const online = isOnline();
      let message = "";
      let show = false;
      if (!online) {
        message = "Offline.";
        show = true;
      } else if (!this.syncEnabled) {
        message = "Sync is disabled.";
        show = true;
      }
      this.syncStatusMessage = message;
      this.showSyncStatus = show;
    },
    loadAndDisplayDeck: async function() {
      try {
        console.log("Loading and displaying deck...");
        console.log("[loadAndDisplayDeck] this.read:", JSON.parse(JSON.stringify(this.read)));
        const guidsToDisplay = this.currentDeckGuids.map((item) => item.guid);
        const items = [];
        const readSet = new Set(this.read.map((h) => h.guid));
        const starredSet = new Set(this.starred.map((s) => s.guid));
        const seenGuidsForDeck = /* @__PURE__ */ new Set();
        for (const guid of guidsToDisplay) {
          if (typeof guid !== "string" || !guid) continue;
          const item = this.feedItems[guid];
          if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
            const mappedItem = mapRawItem(item, formatDate);
            mappedItem.isRead = readSet.has(mappedItem.guid);
            mappedItem.isStarred = starredSet.has(mappedItem.guid);
            items.push(mappedItem);
            seenGuidsForDeck.add(mappedItem.guid);
          }
        }
        console.log("[loadAndDisplayDeck] items before deck assignment:", JSON.parse(JSON.stringify(items)));
        this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
        console.log("[loadAndDisplayDeck] this.deck after assignment:", JSON.parse(JSON.stringify(this.deck)));
        console.log(`Deck loaded with ${this.deck.length} items`);
      } catch (error2) {
        console.error("Error loading deck:", error2);
        this.deck = [];
      }
    },
    loadFeedItemsFromDB: async function() {
      try {
        console.log("Loading feed items from database...");
        if (!this.db) {
          console.warn("Database not available");
          this.entries = [];
          this.feedItems = {};
          return;
        }
        const rawItemsFromDb = await getAllFeedItems();
        console.log(`Retrieved ${rawItemsFromDb.length} raw items from DB`);
        this.feedItems = {};
        const uniqueEntries = [];
        const seenGuids = /* @__PURE__ */ new Set();
        rawItemsFromDb.forEach((item) => {
          if (item && item.guid && !seenGuids.has(item.guid)) {
            this.feedItems[item.guid] = item;
            uniqueEntries.push(item);
            seenGuids.add(item.guid);
          }
        });
        this.entries = mapRawItems(uniqueEntries, formatDate) || [];
        console.log(`Processed ${this.entries.length} unique entries`);
      } catch (error2) {
        console.error("Error loading feed items from DB:", error2);
        this.entries = [];
        this.feedItems = {};
      }
    },
    get filteredEntries() {
      if (!Array.isArray(this.deck)) this.deck = [];
      let filtered = [];
      const readMap = new Map(this.read.map((h) => [h.guid, h.readAt]));
      const starredMap = new Map(this.starred.map((s) => [s.guid, s.starredAt]));
      switch (this.filterMode) {
        case "unread":
          filtered = this.deck.filter((item) => !item.isStale && !readMap.has(item.guid));
          break;
        case "all":
          filtered = this.entries;
          break;
        case "read":
          filtered = this.entries.filter((e) => readMap.has(e.guid)).sort((a, b) => new Date(readMap.get(b.guid)).getTime() - new Date(readMap.get(a.guid)).getTime());
          break;
        case "starred":
          filtered = this.entries.filter((e) => starredMap.has(e.guid)).sort((a, b) => new Date(starredMap.get(b.guid)).getTime() - new Date(starredMap.get(a.guid)).getTime());
          break;
      }
      if (this.filterMode !== "unread") {
        filtered = filtered.map((e) => ({ ...e, isRead: readMap.has(e.guid), isStarred: starredMap.has(e.guid) }));
      }
      const keywordBlacklist = (this.keywordBlacklistInput ?? "").split(/\r?\n/).map((kw) => kw.trim().toLowerCase()).filter((kw) => kw.length > 0);
      if (keywordBlacklist.length > 0) {
        filtered = filtered.filter((item) => {
          const searchable = `${item.title} ${item.description}`.toLowerCase();
          return !keywordBlacklist.some((keyword) => searchable.includes(keyword));
        });
      }
      return filtered;
    },
    isStarred: function(guid) {
      return this.starred.some((e) => e.guid === guid);
    },
    // --- FIX: Centralize UI updates ---
    toggleStar: async function(guid) {
      try {
        await toggleItemStateAndSync(this, guid, "starred");
        await this._reconcileAndRefreshUI();
        this.updateSyncStatusMessage();
      } catch (error2) {
        console.error("Error toggling star:", error2);
        createStatusBarMessage("Error updating star status", "error");
      }
    },
    // --- FIX: Centralize UI updates ---
    toggleRead: async function(guid) {
      try {
        await toggleItemStateAndSync(this, guid, "read");
        this.deck = [...this.deck];
        this.updateSyncStatusMessage();
        this.updateCounts();
      } catch (error2) {
        console.error("Error toggling read:", error2);
        createStatusBarMessage("Error updating read status", "error");
      }
    },
    processShuffle: async function() {
      try {
        await processShuffle(this);
        await this.loadAndDisplayDeck();
        this.updateCounts();
      } catch (error2) {
        console.error("Error processing shuffle:", error2);
        createStatusBarMessage("Error shuffling items", "error");
      }
    },
    saveRssFeeds: async function() {
      const feedsData = {};
      const defaultCategory = "Uncategorized";
      const defaultSubcategory = "Default";
      feedsData[defaultCategory] = {};
      feedsData[defaultCategory][defaultSubcategory] = [];
      this.rssFeedsInput.split(/\r?\n/).map((url) => url.trim()).filter(Boolean).forEach((url) => {
        feedsData[defaultCategory][defaultSubcategory].push({ url });
      });
      await saveSimpleState("rssFeeds", feedsData);
      createStatusBarMessage("RSS Feeds saved!", "success");
      this.loading = true;
      this.progressMessage = "Saving feeds and performing full sync...";
      await performFullSync(this);
      await this.loadFeedItemsFromDB();
      const deckResult = await manageDailyDeck(
        this.entries,
        this.read,
        this.starred,
        this.shuffledOutItems,
        this.shuffleCount,
        this.filterMode,
        this.lastShuffleResetDate
      );
      this.deck = deckResult.deck;
      this.currentDeckGuids = deckResult.currentDeckGuids;
      this.progressMessage = "";
      this.loading = false;
    },
    async saveKeywordBlacklist() {
      try {
        const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map((kw) => kw.trim()).filter(Boolean);
        await saveSimpleState("keywordBlacklist", keywordsArray);
        this.keywordSaveMessage = "Keywords saved!";
        createStatusBarMessage("Keyword Blacklist saved!", "success");
        this.updateCounts();
      } catch (error2) {
        console.error("Error saving keyword blacklist:", error2);
        createStatusBarMessage("Error saving keywords", "error");
      }
    },
    updateCounts: function() {
      try {
        updateCounts(this);
      } catch (error2) {
        console.error("Error updating counts:", error2);
      }
    },
    scrollToTop: function() {
      try {
        scrollToTop();
      } catch (error2) {
        console.error("Error scrolling to top:", error2);
      }
    },
    _loadInitialState: async function() {
      try {
        const [syncEnabled, imagesEnabled, urlsNewTab, filterMode, themeState] = await Promise.all([
          loadSimpleState("syncEnabled"),
          loadSimpleState("imagesEnabled"),
          loadSimpleState("openUrlsInNewTabEnabled"),
          loadFilterMode(),
          loadSimpleState("theme", "userSettings")
        ]);
        this.syncEnabled = syncEnabled.value ?? true;
        this.imagesEnabled = imagesEnabled.value ?? true;
        this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
        this.filterMode = filterMode;
        this.theme = themeState.value ?? "dark";
        this.isOnline = isOnline();
        const [rssFeeds, keywordBlacklist] = await Promise.all([
          loadSimpleState("rssFeeds"),
          loadSimpleState("keywordBlacklist")
        ]);
        let allRssUrls = [];
        if (rssFeeds.value && typeof rssFeeds.value === "object") {
          for (const category in rssFeeds.value) {
            if (typeof rssFeeds.value[category] === "object") {
              for (const subcategory in rssFeeds.value[category]) {
                if (Array.isArray(rssFeeds.value[category][subcategory])) {
                  rssFeeds.value[category][subcategory].forEach((feed) => {
                    if (feed && feed.url) {
                      allRssUrls.push(feed.url);
                    }
                  });
                }
              }
            }
          }
        }
        this.rssFeedsInput = allRssUrls.join("\n");
        this.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) ? keywordBlacklist.value.join("\n") : "";
      } catch (error2) {
        console.error("Error loading initial state:", error2);
        this.syncEnabled = true;
        this.imagesEnabled = true;
        this.openUrlsInNewTabEnabled = true;
        this.filterMode = "unread";
        this.theme = "dark";
        this.rssFeedsInput = "";
        this.keywordBlacklistInput = "";
      }
    },
    _loadAndManageAllData: async function(initialEntries) {
      try {
        console.log("Loading and managing all data...");
        const [rawStarredState, rawShuffledOutState, currentDeckState, shuffleState, rawReadState] = await Promise.all([
          loadArrayState("starred"),
          loadArrayState("shuffledOutGuids"),
          loadCurrentDeck(),
          loadShuffleState(),
          loadArrayState("read")
        ]);
        const sanitizedStarred = [];
        if (Array.isArray(rawStarredState.value)) {
          for (const item of rawStarredState.value) {
            const guid = typeof item === "string" ? item : item?.guid;
            if (guid) sanitizedStarred.push({ guid, starredAt: item?.starredAt || (/* @__PURE__ */ new Date()).toISOString() });
          }
        }
        this.starred = [...new Map(sanitizedStarred.map((item) => [item.guid, item])).values()];
        const sanitizedShuffled = [];
        if (Array.isArray(rawShuffledOutState.value)) {
          for (const item of rawShuffledOutState.value) {
            const guid = typeof item === "string" ? item : item?.guid;
            if (guid) sanitizedShuffled.push({ guid, shuffledAt: item?.shuffledAt || (/* @__PURE__ */ new Date()).toISOString() });
          }
        }
        this.shuffledOutItems = [...new Map(sanitizedShuffled.map((item) => [item.guid, item])).values()];
        const sanitizedRead = [];
        if (Array.isArray(rawReadState.value)) {
          for (const item of rawReadState.value) {
            const guid = typeof item === "string" ? item : item?.guid;
            if (guid) sanitizedRead.push({ guid, readAt: item?.readAt || (/* @__PURE__ */ new Date()).toISOString() });
          }
        }
        this.read = [...new Map(sanitizedRead.map((item) => [item.guid, item])).values()];
        this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
        this.shuffleCount = shuffleState.shuffleCount || 0;
        this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;
        this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
        console.log(`Loaded ${this.read.length} read items`);
        this.entries = initialEntries || [];
        const deckResult = await manageDailyDeck(
          Array.from(this.entries),
          this.read,
          this.starred,
          this.shuffledOutItems,
          this.shuffleCount,
          this.filterMode,
          this.lastShuffleResetDate
        );
        let managedDeck = [];
        let managedCurrentDeckGuids = [];
        let managedShuffledOutGuids = [];
        let managedShuffleCount = 0;
        let managedLastShuffleResetDate = null;
        if (deckResult && Array.isArray(deckResult.deck)) {
          managedDeck = deckResult.deck;
          managedCurrentDeckGuids = deckResult.currentDeckGuids || [];
          managedShuffledOutGuids = deckResult.shuffledOutGuids || [];
          managedShuffleCount = deckResult.shuffleCount || 0;
          managedLastShuffleResetDate = deckResult.lastShuffleResetDate || null;
        } else {
          console.warn("[UI] manageDailyDeck returned an invalid deckResult. Using default empty values.");
        }
        this.currentDeckGuids = managedCurrentDeckGuids;
        this.deck = managedDeck;
        this.shuffledOutItems = managedShuffledOutGuids;
        this.shuffleCount = managedShuffleCount;
        this.lastShuffleResetDate = managedLastShuffleResetDate;
        await this.loadAndDisplayDeck();
        console.log("Data management complete - final deck size:", this.deck.length);
      } catch (error2) {
        console.error("Error loading and managing data:", error2);
        this.starred = [];
        this.shuffledOutItems = [];
        this.currentDeckGuids = [];
        this.shuffleCount = 0;
        this.read = [];
        this.deck = [];
      }
    },
    updateAllUI: async function() {
      try {
        this.updateCounts();
        await this.loadAndDisplayDeck();
      } catch (error2) {
        console.error("Error updating UI:", error2);
      }
    },
    _setupWatchers: function() {
      if (!this._initComplete) return;
      this.$watch("openSettings", async (isOpen) => {
        if (isOpen) ;
        else {
          await saveCurrentScrollPosition();
        }
      });
      this.$watch("openUrlsInNewTabEnabled", () => {
        this.$nextTick(() => {
          document.querySelectorAll(".itemdescription").forEach((el) => this.handleEntryLinks(el));
        });
      });
      this.$watch("filterMode", async (newMode) => {
        if (!this._initComplete) return;
        try {
          await setFilterMode(this, newMode);
          if (newMode === "unread") {
            const deckResult = await manageDailyDeck(
              this.entries,
              this.read,
              this.starred,
              this.shuffledOutItems,
              this.shuffleCount,
              this.filterMode,
              this.lastShuffleResetDate
            );
            this.deck = deckResult.deck;
            this.currentDeckGuids = deckResult.currentDeckGuids;
          }
          this.scrollToTop();
        } catch (error2) {
          console.error("Error in filterMode watcher:", error2);
        }
      });
    },
    _setupEventListeners: function() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this._initComplete) {
          this.performBackgroundSync();
        }
      });
      const backgroundSync = async () => {
        if (!this.syncEnabled || !this.isOnline) return;
        try {
          await performFeedSync(this);
          await pullUserState();
          await this._loadAndManageAllData();
          this.deckManaged = true;
        } catch (error2) {
          console.error("Background sync failed:", error2);
        }
      };
      window.addEventListener("online", async () => {
        this.isOnline = true;
        this.updateSyncStatusMessage();
        if (this.syncEnabled) {
          try {
            await processPendingOperations();
            await backgroundSync();
          } catch (error2) {
            console.error("Error handling online event:", error2);
          }
        }
      });
      window.addEventListener("offline", () => {
        this.isOnline = false;
        this.updateSyncStatusMessage();
      });
      window.addEventListener("beforeunload", () => {
        try {
          if (this.filterMode === "unread" && !this.openSettings) {
            saveCurrentScrollPosition();
          }
        } catch (error2) {
          console.error("Error saving scroll position on beforeunload:", error2);
        }
      });
    },
    _startPeriodicSync: function() {
      let lastActivityTimestamp = Date.now();
      const recordActivity = () => lastActivityTimestamp = Date.now();
      ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach((event) => {
        document.addEventListener(event, recordActivity, true);
      });
      const SYNC_INTERVAL_MS = 5 * 60 * 1e3;
      const INACTIVITY_TIMEOUT_MS = 60 * 1e3;
      setInterval(async () => {
        const now = Date.now();
        if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || now - lastActivityTimestamp > INACTIVITY_TIMEOUT_MS) {
          return;
        }
        try {
          await performFeedSync(this);
          await pullUserState();
          await this._loadAndManageAllData();
          this.deckManaged = true;
        } catch (error2) {
          console.error("Periodic sync failed:", error2);
        }
      }, SYNC_INTERVAL_MS);
    },
    _initScrollObserver: function() {
      try {
        const observer2 = new IntersectionObserver(async (entries) => {
        }, {
          root: document.querySelector("#items"),
          rootMargin: "0px",
          threshold: 0.1
        });
        const feedContainer = document.querySelector("#items");
        if (!feedContainer) {
          console.warn("Feed container not found for scroll observer");
          return;
        }
        const observeElements = () => {
          feedContainer.querySelectorAll("[data-guid]").forEach((item) => {
            observer2.observe(item);
          });
        };
        observeElements();
        const mutationObserver = new MutationObserver(() => {
          observer2.disconnect();
          observeElements();
        });
        mutationObserver.observe(feedContainer, { childList: true, subtree: true });
        this.scrollObserver = observer2;
      } catch (error2) {
        console.error("Error initializing scroll observer:", error2);
      }
    },
    handleEntryLinks: function(element) {
      if (!element) return;
      try {
        element.querySelectorAll("a").forEach((link) => {
          if (link.hostname !== window.location.hostname) {
            if (this.openUrlsInNewTabEnabled) {
              link.setAttribute("target", "_blank");
              link.setAttribute("rel", "noopener noreferrer");
            } else {
              link.removeAttribute("target");
            }
          }
        });
      } catch (error2) {
        console.error("Error handling entry links:", error2);
      }
    }
  };
}
module_default.data("rssApp", rssApp);
module_default.start();
