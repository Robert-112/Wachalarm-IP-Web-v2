module.exports = function(twitter, uuidv4, app_cfg) {

  function alert_twitter_list(twitter_data, callback) {
   // tw.tw_screen_name, tw_consumer_key, tw.tw_consumer_secret, tw.tw_access_token_key, tw.tw_access_token_secret, we.uuid, we.einsatzart, wa.name_wache

     var client = new twitter({
      consumer_key: twitter_data.tw_consumer_key,
      consumer_secret: twitter_data.tw_consumer_secret,
      access_token_key: twitter_data.tw_access_token_key,
      access_token_secret: twitter_data.tw_access_token_secret
    });
    
    /*var params = {owner_screen_name: twitter_data.tw_screen_name, slug: twitter_data.list, count: 50};
    client.get('lists/members', params, function(error, members, response) {
      if (!error) {
        console.log(members);
        callback && callback(members);
      }  else {
        console.log(error);
        callback && callback(null);
      };
    });*/

    var params = {screen_name: twitter_data.tw_screen_name};
    client.get('lists/list', params, function(error, lists, response) {
      if (!error) {
        

        var list_obj = lists.filter(function(o){return o.name == twitter_data.list;} );
        console.log(JSON.stringify(list_obj));
        console.log(list_obj[0].id);

        callback && callback(lists);
      }  else {
        console.log(error);
        callback && callback(null);
      };
    });


  };

  return {
    alert_twitter_list: alert_twitter_list
  };
};
