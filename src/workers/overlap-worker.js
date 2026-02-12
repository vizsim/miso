/* eslint-disable no-restricted-globals */
// Heavy overlap/catchment computations off main thread.
self.importScripts(
  'https://unpkg.com/@turf/turf@6.5.0/turf.min.js',
  'https://unpkg.com/h3-js@4.4.0/dist/h3-js.umd.js',
  '../features/isochrones/isochrone-renderer.js',
  '../features/isochrones/overlap-renderer.js'
);

self.onmessage = (event) => {
  const msg = event?.data || {};
  const id = msg.id;
  const type = msg.type;
  const payload = msg.payload || {};
  try {
    let result = null;
    if (type === 'overlap') {
      result = OverlapRenderer.computeOverlapPerBucket(payload.savedIsochrones || []);
    } else if (type === 'system_optimal') {
      result = OverlapRenderer.computeSystemOptimalCatchments(
        payload.savedIsochrones || [],
        { maxBucketByIndex: payload.maxBucketByIndex || null }
      );
    } else {
      throw new Error(`Unknown worker task type: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
