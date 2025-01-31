// author: InMon Corp.
// version: 0.1
// date: 1/31/2025
// description: AI Metrics
// copyright: Copyright (c) 2024-2025 InMon Corp. ALL RIGHTS RESERVED

include(scriptdir() + '/inc/trend.js');

const T = getSystemProperty('ai.flow.t') || 2;
const SYSLOG_HOST = getSystemProperty('ai.syslog.host');
const SYSLOG_PORT = getSystemProperty('ai.syslog.port') || 514;
const FACILITY = getSystemProperty('ai.syslog.facility') || 16; // local0
const SEVERITY = getSystemProperty('ai.syslog.severity') || 5;  // notice

const SEP = '_SEP_';

function sendWarning(msg) {
  if(SYSLOG_HOST) {
    try {
      syslog(SYSLOG_HOST,SYSLOG_PORT,FACILITY,SEVERITY,msg);
    } catch(e) {
      logWarning('ai-metrics cannot send syslog to ' + SYSLOG_HOST);
    }
  } else logWarning(JSON.stringify(msg));
}

var trend = new Trend(300,1);
var points = {};

baselineCreate('load', 60, 2, 2);
baselineCreate('period', 20, 2, 1);

setFlow('ai_bytes_fast', {
  value:'bytes',
  t:0.1,
  aggMode:'edge'
});

setFlow('ai_bytes', {
  value:'bytes',
  filter:'direction=ingress',
  t:T
});

setFlow('ai_ecn', {
  value:'frames',
  filter:'ibbt_offset!=null&direction=ingress&(ipecn=11|ip6ecn=11)',
  t:T
});

// https://enterprise-support.nvidia.com/s/article/understanding-rocev2-congestion-management
setFlow('ai_cnp', {
  value:'frames',
  filter:'ibbtopcode=129&ibbtse=false&ibbtm=false&direction=ingress',
  t:T
});

// RDMA
setFlow('ai_rdma_ops', {
  value: 'frames',
  values: ['ibbtrdmalen'],
  t: T,
  aggMode:'edge'
});

setFlow('ai_operation',{
  keys:'concat:\\::ibbtoptransport:ibbtopname',
  value:'frames',
  t:T,
  aggMode:'edge'
});

setFlow('ai_credits', {
  value:'avg:ibbtaethack',
  values: ['min:ibbtaethack','max:ibbtaethack'],
  t: T,
  aggMode:'edge'
});

setFlow('ai_drop_reasons', {
  keys:'reason',
  value:'frames',
  t: T,
  dropped: true
});

function getMetric(res, idx, defVal) {
  var val = defVal;
  if(res && res.length && res.length > idx && res[idx].hasOwnProperty('metricValue')) val = res[idx].metricValue;
  return val;
}

var other = '-other-';
function calculateTopN(agents,metric,n,minVal,total,scale) {     
  var top = activeFlows(agents,metric,n,minVal);
  var topN = {};
  if(top) {
    var sum = 0;
    top.forEach(function(entry) {
      var val = entry.value * (scale || 1);
      topN[entry.key] = val;
      sum += val;
    });
    if(total > sum) topN[other] = total - sum;
  }
  return topN;
}


var load_threshold = 0;
var load_prev_time = 0;
setIntervalHandler(function(now) {
  var res = metric('EDGE','sum:ai_bytes');
  points['bps'] = getMetric(res,0,0) * 8;

  res = activeFlows('EDGE','ai_rdma_ops',1)[0] || {};
  points['rdma_ops'] = res.value || 0;
  points['rdma_bytes'] = (res.values && res.values[0] || 0) / (res.value || 1);

  res = activeFlows('EDGE','ai_credits',1)[0] || {};
  points['aeth_credits_avg'] = res.value || 0;
  points['aeth_credits_min'] = (res.values && res.values[0] || 0);
  points['aeth_credits_max'] = (res.values && res.values[1] || 0);

  res = metric('CORE','med:ai_bytes')[0].quartiles || {};
  points['core_min_bps'] = (res.min || 0) * 8;
  points['core_q1_bps'] = (res.q1 || 0) * 8;
  points['core_med_bps'] = (res.med || 0) * 8;
  points['core_q3_bps'] = (res.q3 || 0) * 8;
  points['core_max_bps'] = (res.max || 0) * 8;

  res = metric('EDGE','med:ai_bytes')[0].quartiles || {};
  points['edge_min_bps'] = (res.min || 0) * 8;
  points['edge_q1_bps'] = (res.q1 || 0) * 8;
  points['edge_med_bps'] = (res.med || 0) * 8;
  points['edge_q3_bps'] = (res.q3 || 0) * 8;
  points['edge_max_bps'] = (res.max || 0) * 8;

  points['top-5-operations'] = calculateTopN('EDGE','ai_operation',5,1,0,1);

  res = metric('TOPOLOGY','sum:ifindiscards,sum:ifinerrors,sum:ifoutdiscards,sum:ifouterrors,sum:ai_ecn,sum:ai_cnp');
  points['discards_in'] = getMetric(res,0,0);
  points['errors_in'] = getMetric(res,1,0);
  points['discards_out'] = getMetric(res,2,0);
  points['errors_out'] = getMetric(res,3,0);
  points['ecn_pps'] = getMetric(res,4,0);
  points['cnp_pps'] = getMetric(res,5,0);

  points['top-5-drop-reasons'] = calculateTopN('TOPOLOGY','ai_drop_reasons',5,0.0001,0,1);

  res = baselineStatistics('period');
  points['period'] = res ? res.mean / 1000 : 0;

  trend.addPoints(now,points);

  var status = baselineCheck('load', points.bps);
  switch(status) {
    case 'learning':
      break;
    case 'normal':
      let stats = baselineStatistics('load');
      if(load_threshold == 0 || load_threshold < stats.min || load_threshold > stats.max) {
        load_threshold = stats.mean;
        load_prev_time = 0;
        setThreshold('ai_bytes_fast', {metric:'ai_bytes_fast', timeout:0.2, value: load_threshold / 8});
      }
      break;
    case 'high':
    case 'low':
      clearThreshold('ai_bytes_fast');
      load_threshold = 0;
      baselineReset('load');
      break;
  }
},1);

setEventHandler(function(evt) {
  if(load_prev_time == 0 || load_threshold == 0) {
    load_prev_time = evt.timestamp;
    return;
  }
  baselineCheck('period',evt.timestamp - load_prev_time);
  load_prev_time = evt.timestamp;
}, ['ai_bytes_fast']);

const prometheus_prefix = (getSystemProperty('prometheus.metric.prefix') || 'sflow_') + 'ai_';

function prometheus() {
  return Object.keys(points)
    .filter((key) => typeof points[key] == 'number')
    .reduce((acc,key) => acc + prometheus_prefix+key+' ' + (points[key] || 0) + '\n','');
}

setHttpHandler(function(req) {
  var result, rows, path = req.path;
  if(!path || path.length == 0) throw 'not_found';
  if(path.length === 1 && 'prometheus' === path[0] && 'txt' === req.format) {
    return prometheus();
  }
  if('json' !== req.format) throw 'not_found';
  switch(path[0]) {
    case 'trend':
      if(path.length > 1) throw 'not_found'; 
      result = {};
      result.trend = req.query.after ? trend.after(parseInt(req.query.after)) : trend;
      break;
    case 'metric':
      if(path.length == 1) result = points;
      else {
        if(path.length != 2) throw 'not_found';
        if(points.hasOwnProperty(path[1])) result = points[path[1]];
        else throw 'not_found';
      }
      break;
    default: throw 'not_found';
  }
  return result;
});
