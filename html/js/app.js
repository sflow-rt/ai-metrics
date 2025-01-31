$(function() {
  var restPath = '../scripts/metrics.js/';
  var trendURL = restPath + 'trend/json';
  var SEP = '_SEP_';

  function setNav(target) {
    $('.navbar .nav-item a[href="'+target+'"]').parent().addClass('active').siblings().removeClass('active');
    $(target).show().siblings().hide();
    window.sessionStorage.setItem('nccl_metrics_nav',target);
    window.history.replaceState(null,'',target);
  }

  var hash = window.location.hash;
  if(hash && $('.navbar .nav-item a[href="'+hash+'"]').length == 1) setNav(hash);
  else setNav(window.sessionStorage.getItem('ixp_metrics_nav') || $('.navbar .nav-item a').first().attr('href'));

  $('.navbar .nav-link').on('click', function(e) {
    var selected = $(this).attr('href');
    setNav(selected);
    if('#traffic' === selected) $.event.trigger({type:'updateChart'});
  });

  $('a[href^="#"]').on('click', function(e) {
    e.preventDefault();
  });

  $('#traffic').on('click', 'a', function(e) {
    e.preventDefault();
  });

  var colors = $.inmon.stripchart.prototype.options.colors;

  var db = {};

  $('#total_bps').chart({
    type: 'trend',
    stack: true,
    includeOther: false,
    metrics: ['bps'],
    units: 'Bits per Second'},
  db);
  $('#core_bps').chart({
    type: 'trend',
    stack: false,
    includeOther: false,
    metrics: ['core_max_bps','core_q3_bps','core_med_bps','core_q1_bps','core_min_bps'],
    legend: ['Max','Q3','Med','Q1','Min'],
    units: 'Bits per Second'},
  db);
  $('#edge_bps').chart({
    type: 'trend',
    stack: false,
    includeOther: false,
    metrics: ['edge_max_bps','edge_q3_bps','edge_med_bps','edge_q1_bps','edge_min_bps'],
    legend: ['Max','Q3','Med','Q1','Min'],
    units: 'Bits per Second'},
  db);
  $('#congestion').chart({
     type: 'trend',
     stack: false,
     includeOther: false,
     metrics: ['ecn_pps','cnp_pps'],
     legend: ['ECN','CNP'],
     units: 'Packets per Second'},
  db);
  $('#rdmaoperations').chart({
     type: 'trend',
     stack: true,
     includeOther: false,
     metrics: ['rdma_ops'],
     units: ['Operations per Seconds']},
  db);
  $('#rdmabytes').chart({
     type: 'trend',
     stack: true,
     includeOther: false,
     metrics: ['rdma_bytes'],
     units: ['Bytes per Operation']},
  db);
  $('#credits').chart({
     type: 'trend',
     stack: false,
     metrics: ['aeth_credits_avg','aeth_credits_min','aeth_credits_max'],
     legend: ['Avg','Min','Max'],
     units: ['Credits per ACK']},
  db);
  $('#operations').chart({
     type: 'topn',
     stack: true,
     includeOther: false,
     metric: 'top-5-operations',
     units: ['Packets per Seconds']},
  db);
  $('#period').chart({
    type: 'trend',
    stack: true,
    includeOther: false,
    metrics: ['period'],
    units: 'Seconds'},
  db);
  $('#errors').chart({
     type: 'trend',
     stack: false,
     includeOther: false,
     metrics: ['errors_in','errors_out'],
     legend: ['In','Out'],
     units: 'Packets per Second'},
  db);
  $('#discards').chart({
     type: 'trend',
     stack: false,
     includeOther: false,
     metrics: ['discards_in','discards_out'],
     legend: ['In','Out'],
     units: 'Packets per Second'},
  db);
  $('#reasons').chart({
     type: 'topn',
     stack: true,
     includeOther: false,
     metric: 'top-5-drop-reasons',
     units: ['Packets per Seconds']},
  db);

  function updateData(data) {
    if(!data 
      || !data.trend 
      || !data.trend.times 
      || data.trend.times.length == 0) return;
    
    if(db.trend) {
      // merge in new data
      var maxPoints = db.trend.maxPoints;
      db.trend.times = db.trend.times.concat(data.trend.times);
      var remove = db.trend.times.length > maxPoints ? db.trend.times.length - maxPoints : 0;
      if(remove) db.trend.times = db.trend.times.slice(remove);
      for(var name in db.trend.trends) {
        db.trend.trends[name] = db.trend.trends[name].concat(data.trend.trends[name]);
        if(remove) db.trend.trends[name] = db.trend.trends[name].slice(remove);
      }
    } else db.trend = data.trend;
    
    db.trend.start = new Date(db.trend.times[0]);
    db.trend.end = new Date(db.trend.times[db.trend.times.length - 1]);
    db.trend.values = data.trend.values;

    $.event.trigger({type:'updateChart'});
  }

  (function pollTrends() {
    $.ajax({
      url: trendURL,
      dataType: 'json',
      data: db.trend && db.trend.end ? {after:db.trend.end.getTime()} : null,
      success: function(data) {
        if(data) {
          updateData(data);
        } 
      },
      complete: function(result,status,errorThrown) {
        setTimeout(pollTrends,1000);
      },
      timeout: 60000
    });
  })();

  $(window).resize(function() {
    $.event.trigger({type:'updateChart'});
  });
});
