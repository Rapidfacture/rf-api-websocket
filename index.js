
module.exports.start = function (options, startNextModule) {

      log.success('Session started')
      startNextModule()
   }
}
