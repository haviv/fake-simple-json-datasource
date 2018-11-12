var express = require('express');
var bodyParser = require('body-parser');
var _ = require('lodash');
var app = express();
var http = require('http');
const https = require('https');

var username = 'haviv11';
var passw = 'haviv11';
var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + new Buffer(username + ':' + passw).toString('base64')
  };
var host = 'sensupilot.service-now.com';
var port = 443;
var all_metrics;
var all_metrics_last_update = new Date();
var metric2ci_cache = {};
app.use(bodyParser.json());

function get_options (_path, _method){
  var options = {
    host: host,
    port: port,
    path: _path,
    method: _method,
    headers: headers
  };
  return options;
}

function setCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "accept, content-type");
}

function forward (ress, res){
    console.log('STATUS: ' + ress.statusCode);
    ress.setEncoding('utf8');
    let data = '';
    ress.on('data', function (chunk) {
      data += chunk;
    });
    ress.on('end', () => {
      if (data){
        console.log(JSON.parse(data).result);
        res.json(JSON.parse(data).result);
      }else{
        res.json([]);
      }
      res.end();
    });
}

function call (ress, callback){
    console.log('STATUS: ' + ress.statusCode);
    ress.setEncoding('utf8');
    let data = '';
    ress.on('data', function (chunk) {
      data += chunk;
    });
    ress.on('end', () => {
      if (data){
        console.log(JSON.parse(data).result);
        callback(JSON.parse(data).result);
      }else{
        callback([]);
      }
    });
}


//==========Test Conn=========
app.all('/', function(req, res) {
  setCORSHeaders(res);
  res.send('I have a quest for you!');
  res.end();
});

function get_metrics (ci_type, result){
  if (ci_type){
    return result[ci_type];
  }else{
    var metrics = [];
    Object.keys(result).forEach(function(key) {
      metrics.push(key);
    })
    return metrics;
  }
}
//=========Search=============
app.all('/search', function(req, res){
  setCORSHeaders(res);
  console.log(req.url);
  console.log(req.body);
  console.log('-->BODY: '+JSON.stringify(req.body));
 if (all_metrics && (new Date().getTime() - all_metrics_last_update.getTime()  < 1000*60*60)){
console.log("taking metrics from cache "+new Date().getTime()+":"+all_metrics_last_update.getTime());
     console.log("taking metrics from cache");
      var result = get_metrics(req.body.ci_type , all_metrics);
      res.json(result);
      res.end();
  }else{
console.log("taking metrics from query");
    var options = get_options ('/api/sn_itmon/monitoring/search2', 'POST');
    var post_req = https.request(options, (ress) => {
      ress.setEncoding('utf8');
      let data = '';
      ress.on('data', function (chunk) {
        data += chunk;
      });
      ress.on('end', () => {
        if (data){
          console.log(JSON.parse(data).result);
          all_metrics = JSON.parse(data).result;
          res.json(get_metrics(req.body.ci_type , all_metrics));
        }else{
          res.json([]);
        }
        res.end();
      });

      });
    all_metrics_last_update = new Date();
    post_req.write("");
    post_req.end();
  }
});

//==========Annotations=========
app.all('/annotations', function(req, res) {
  setCORSHeaders(res);
  console.log(req.url);
  console.log(req.body);
  res.json([]);
  res.end();
});

function handleAdHocFilters (adhocFilters, prefix){
  var _query = "";
  _.each(adhocFilters, function(filter) {

    _query +=  prefix + filter.key.replace("@", "") ;
     switch(filter.operator) {
      case "=":
          _query += "=" +filter.value +"^";
          break;
      case "!=":
          _query += "!=" +filter.value+"^";
          break;
      case ">":
          _query += ">=" +filter.value+"^";
          break;
      case "<":
          _query += "<=" +filter.value+"^";
          break;
      case "=~":
          _query += "LIKE" +filter.value+"^";
          break;
      case "!~":
          _query += "NOT%20LIKE" +filter.value+"^";
          break;
      default:
          _query += "LIKE" +filter.value+"^";
    }
  });
  console.log("ad hoc filter is:"+_query);
  return _query;
}

//==========Query=========
app.all('/query', function(req, res){
  setCORSHeaders(res);
  console.log(req.url);
  console.log(req.body);
  console.log('-->BODY: '+JSON.stringify(req.body));


   //handle regular expression in metrics names
  var body = [];
  _.each(req.body.targets, function(target) {
    if (target.type == "timeserie" && target.target.includes(".*")){
        var ci_metrics = get_metrics(target.ci_type , all_metrics);
        var pattern = target.target;
        _.each (ci_metrics, function (metric){
          if (metric.search(pattern) > -1){
            obj = JSON.parse(JSON.stringify(target));
            obj.target = metric;
            body.push(obj);
          }
        });
    }else{
      body.push(target);
    }
  });

  console.log('===========body is '+JSON.stringify(body));


  var tsResult = [];
  var _start = req.body.range.from.substring(0,19);
  var _end = req.body.range.to.substring(0,19);
  var _length = body.length;
  var index = 0;

   _.each(body, function(target) {
      var _target = target.target;
      var _type = target.type;

      var _query = "";
      if (_type == "timeserie"){
        _query = handleAdHocFilters(req.body.adhocFilters, "");
      }else{
        _query = handleAdHocFilters(req.body.adhocFilters, "cmdb_ci.");
      }

      console.log("working on metric:"+ _target);
      if (!_target){
        return;
      }
      var _transform  = "";
      if (target.query)
        _query += target.query;
      if(target.transform)
        _transform = target.transform;

      if (_type == "timeserie"){
          var _ci_type = "";
          get_ci_type(_target, function (data){

            _ci_type = target.ci_type;;
         metric2ci_cache[_target] = data;
	 var _path = '/api/now/v1/clotho/transform/'+_ci_type+"/"+_target+"?sysparm_query="+_query+"&sysparm_transforms="+_transform+"&sysparm_start="+_start+"&sysparm_end="+_end+"&sysparm_display_value=true&sysparm_subject_limit=30";

            console.log("query is:"+_path);
            call_clotho (_path, function (result){
              parse_clotho_result (result, tsResult);
              index = index+1;
              if (index == _length){
                res.json(tsResult);
            //    console.log("===>"+JSON.stringify(tsResult));
                res.end();
              }
            });//call_clotho

          });//get_ci_type
      }else{
        ///now/table/em_alert?sysparm_query=number%3D1&sysparm_limit=1"
        console.log("fetching table:"+target.ci_type);
        if (!target.ci_type){
          return ;
        }

        var _fields = "";
        //_query += "^sys_updated_on>"+_start+"^sys_updated_on<"+_end;
        var _path = '/api/now/table/'+target.ci_type+"?sysparm_query="+_query+"&sysparm_fields="+_transform+"&sysparm_limit=400&sysparm_display_value=true&sysparm_exclude_reference_link=true";
        console.log("query is:"+_path);
        call_table (_path, function (result){
            parse_table_result (result, tsResult);
            index = index+1;
            if (index == _length){
              res.json(tsResult);
              console.log("===>"+JSON.stringify(tsResult));
              res.end();
            }
          });//call_table

      }

  });//each

});
function call_table(_path, callback){
  var options = get_options (_path, 'GET');
  var post_req = https.request(options, (ress) => {

    let data = '';
    ress.on('data', function (chunk) {
      data += chunk;
    });
    ress.on('end', () => {
      if (data){
        var _data = JSON.parse(data);
        console.log("recieved data from table api");
        callback(_data);
      }else{
        console.log("empty result");
        callback([]);
      }

    });


  });
  post_req.write("");
  post_req.end();
}
function call_clotho(_path, callback){

  var options = get_options (_path, 'GET');
  var post_req = https.request(options, (ress) => {

    let data = '';
    ress.on('data', function (chunk) {
      data += chunk;
    });
    ress.on('end', () => {
      if (data){
        var _data = JSON.parse(data);
        console.log("recieved data from clotho");
        callback(_data);
      }else{
        console.log("empty result");
        callback([]);
      }

    });


  });
  post_req.write("");
  post_req.end();

}//call_clotho

function get_ci_type (metric, callback){
if (metric2ci_cache[metric]){
    console.log("taking metric from cache:"+metric+"-->"+metric2ci_cache[metric]);
    callback (metric2ci_cache[metric]);
  }
  var ci_type = "";
  var options = get_options ('/api/sn_itmon/monitoring/metrictoci?metric='+metric, 'GET');
  var post_req = https.request(options, (ress) => {
    call (ress, callback);
  });

  post_req.write("");
  post_req.end();
}
function parse_table_result (response, tsResult){
  if (response.result){
    //console.log(JSON.stringify(response.result));
    table =
            {
              rows: [],
              columns: [],
              "type":"table"
            };

    for (var i in response.result) {
      var obj = response.result[i];
      var one_row = [];
      Object.keys(obj).forEach(function(key) {
        if (i == 0){
          var acolumn = {text : key , type: 'string'};
          table.columns.push(acolumn);
        }
        one_row.push(obj[key]);
        //console.log('Key : ' + key + ', Value : ' + obj[key])
      })
      table.rows.push(one_row);

    }
    tsResult.push(table);
    //console.log("++++"+JSON.stringify(table));
  }
}
function parse_clotho_result (response, tsResult){
    for (var i in response) {
      var obj = response[i];
      if ((!obj.seriesRef || !obj.seriesRef.metric) && (!obj.label) )
        continue;

      var metric = obj.label;
      var resObj = {};
      resObj.target = metric;
      if (obj.seriesRef && obj.seriesRef.metric){
          metric = obj.seriesRef.metric;
          resObj.target = metric +"@"+obj.label;
      }

      resObj.datapoints = [];
      for (var j in obj.values) {
          var val = [];

          if (obj.values[j].value == "NaN") //if no metric value or timestamp - continue
            continue;

          val.push(obj.values[j].value); //metric value
          var dateStr = obj.values[j].timestamp;
          val.push(new Date(dateStr).valueOf()); //metric timestamp
          resObj.datapoints.push(val);
      }
      tsResult.push(resObj);


    }
}



//=========keys=============
app.all('/tag_keys', function(req, res) {
  setCORSHeaders(res);
  console.log(req.url);
  console.log(req.body);
  console.log('-->BODY: '+JSON.stringify(req.body));
  var options = get_options ('/api/sn_itmon/monitoring/tag_keys2', 'POST');
  var post_req = https.request(options, (ress) => {
    forward (ress, res);
  });

  post_req.write("");
  post_req.end();

});


//=========key Values=============
app.all('/tag_values', function(req, res) {
  setCORSHeaders(res);
  console.log(req.url);
  console.log(req.body);
  console.log('-->BODY: '+JSON.stringify(req.body));
  var options = get_options ('/api/sn_itmon/monitoring/tag_values2', 'POST');
  var post_req = https.request(options, (ress) => {
    forward (ress, res);
  });

  post_req.write(JSON.stringify(req.body));
  post_req.end();

});

app.listen(3333);
console.log("Server is listening to port 3333");
