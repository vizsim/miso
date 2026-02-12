// ==== Isochrone-Parameter Helper ====
const IsochroneParams = {
  getBucketSizeMin() {
    const el = document.getElementById('config-isochrone-bucket-size');
    const v = el ? parseInt(el.value, 10) : 5;
    const size = [1, 2, 3, 5, 10].includes(v) ? v : 5;
    if (CONFIG) CONFIG.ISOCHRONE_BUCKET_SIZE_MIN = size;
    return size;
  },

  syncTimeToBucketSize() {
    const timeInput = Utils.getElement('#config-isochrone-time');
    const bucketSizeMin = this.getBucketSizeMin();
    if (!timeInput) return bucketSizeMin;
    timeInput.min = bucketSizeMin;
    timeInput.step = bucketSizeMin;
    const max = 120;
    timeInput.max = max;
    let timeMin = parseInt(timeInput.value, 10) || bucketSizeMin;
    const rounded = Math.round(timeMin / bucketSizeMin) * bucketSizeMin;
    timeMin = Math.max(bucketSizeMin, Math.min(max, rounded));
    timeInput.value = timeMin;
    CONFIG.ISOCHRONE_TIME_LIMIT = timeMin * 60;
    CONFIG.ISOCHRONE_BUCKETS = Math.round(timeMin / bucketSizeMin);
    return bucketSizeMin;
  },

  getFromUI() {
    const bucketSizeMin = parseInt(document.getElementById('config-isochrone-bucket-size')?.value || '5', 10) || 5;
    let timeMin = parseInt(document.getElementById('config-isochrone-time')?.value || '10', 10) || 10;
    timeMin = Math.round(timeMin / bucketSizeMin) * bucketSizeMin;
    timeMin = Math.max(bucketSizeMin, Math.min(120, timeMin));
    CONFIG.ISOCHRONE_BUCKET_SIZE_MIN = bucketSizeMin;
    CONFIG.ISOCHRONE_TIME_LIMIT = timeMin * 60;
    CONFIG.ISOCHRONE_BUCKETS = Math.round(timeMin / bucketSizeMin);
    return { timeLimitSec: CONFIG.ISOCHRONE_TIME_LIMIT, buckets: CONFIG.ISOCHRONE_BUCKETS };
  }
};

