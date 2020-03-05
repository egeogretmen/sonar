// const { hyperdriveHandler } = require('./hyperdrive')
const hyperdriveMiddleware = require('./hyperdrive')
const collect = require('collect-stream')
const { Router } = require('simple-rpc-protocol')
const express = require('express')
const websocketStream = require('websocket-stream/stream')
const debug = require('debug')
const log = debug('sonar:server')

module.exports = function apiRoutes (api) {
  const router = express.Router()

  // Top level actions
  const deviceHandlers = createDeviceHandlers(api.islands)
  const handlers = createIslandHandlers(api.islands)
  const commandHandler = createCommandHandler(api.islands)

  // Info
  router.get('/_info', deviceHandlers.info)
  // Create island
  router.put('/_create/:name', deviceHandlers.createIsland)

  const islandRouter = express.Router()
  // Change island config
  islandRouter.patch('/', deviceHandlers.updateIsland)
  // Create command stream (websocket)
  islandRouter.ws('/commands', commandHandler)

  // Hyperdrive actions (get and put)
  islandRouter.use('/fs', hyperdriveMiddleware(api.islands))

  // Create record
  islandRouter.post('/db/:schemans/:schemaname', handlers.put)
  // Update record
  islandRouter.put('/db/:schemans/:schemaname/:id', handlers.put)
  // Get record
  islandRouter.get('/db/:schemans/:schemaname/:id', handlers.get)
  islandRouter.get('/db/:id', handlers.get)
  // Search/Query
  islandRouter.post('/_search', handlers.search)
  islandRouter.post('/_query/:name', handlers.query)
  // List schemas
  islandRouter.get('/schema', handlers.getSchemas)
  // Get schema
  islandRouter.get('/schema/:schemans/:schemaname', handlers.getSchema)
  // Put schema
  islandRouter.put('/schema/:schemans/:schemaname', handlers.putSchema)
  // Put source
  // TODO: This route should have the same pattern as the others.
  islandRouter.put('/source/:key', handlers.putSource)

  islandRouter.get('/source', function (req, res, next) {
    const { island } = req
    island.query('records', { schema: 'core/source' }, (err, records) => {
      if (err) return next(err)
      return records
    })
  })

  islandRouter.get('/debug', handlers.debug)

  islandRouter.get('/fs-info', function (req, res, next) {
    const { island } = req
    island.query('records', { schema: 'core/source' }, (err, records) => {
      if (err) return next(err)
      const drives = records
        .filter(record => record.value.type === 'hyperdrive')
        .map(record => record.value)
      let pending = drives.length
      drives.forEach(driveInfo => {
        island.fs.get(driveInfo.key, (err, drive) => {
          driveInfo.writable = drive.writable
          if (--pending === 0) res.send(drives)
        })
      })
      // res.send(drives)
    })
  })


  // Load island if in path.
  router.use('/:island', function (req, res, next) {
    const { island } = req.params
    res.locals.key = island;
    if (!island) return next()
    api.islands.get(island, (err, island) => {
      if (err) return next(err)
      req.island = island
      next()
    })
  }, islandRouter)

  return router
}

function createCommandHandler (islands) {
  const router = new Router({ name: 'server' })
  // router.command('ping', (args, channel) => {
  //   channel.reply('pong')
  //   channel.end()
  // })
  router.on('error', log)
  return function createCommandStream (ws, req) {
    // const { key } = req.params
    const stream = websocketStream(ws, {
      binary: true
    })
    stream.on('error', err => {
      log(err)
    })
    router.connection(stream)
  }
}

function createDeviceHandlers (islands) {
  return {
    info (req, res, next) {
      islands.status((err, status) => {
        if (err) return next(err)
        res.send(status)
      })
    },
    createIsland (req, res, next) {
      const { name } = req.params
      const { key, alias } = req.body
      islands.create(name, { key, alias }, (err, island) => {
        if (err) return next(err)
        res.send({
          key: island.key.toString('hex')
        })
      })
    },
    updateIsland (req, res, next) {
      let config = {};
      if (req.body.hasOwnProperty('share')) {
        config = islands.updateIsland(res.locals.key, req.body) 
      }
      res.send(config)
    }
  }
}

// These handlers all expect a req.island property.
function createIslandHandlers () {
  return {
    put (req, res, next) {
      const { id } = req.params
      const value = req.body
      const schema = expandSchema(req.island, req.params)
      req.island.put({ schema, id, value }, (err, id) => {
        if (err) return next(err)
        res.send({ id })
      })
    },

    get (req, res, next) {
      let { id } = req.params
      const schema = expandSchema(req.island, req.params)
      const opts = req.query || {}
      req.island.get({ schema, id }, opts, (err, records) => {
        if (err) return next(err)
        res.send(records)
      })
    },

    // TODO: This should be something different than get
    // and intead drive different kinds of queries.
    query (req, res, next) {
      const name = req.params.name
      const args = req.body
      const opts = req.query || {}
      req.island.query(name, args, opts, (err, records) => {
        if (err) return next(err)
        res.send(records)
      })
    },

    getSchemas (req, res, next) {
      const schemas = req.island.getSchemas()
      res.send(schemas)
    },

    getSchema (req, res, next) {
      let schema = expandSchema(req.island, req.params)
      req.island.getSchema(schema, (err, schemaValue) => {
        if (err) {
          err.statusCode = 404
          return next(err)
        }
        res.send(schemaValue)
      })
    },

    putSchema (req, res, next) {
      let schema = expandSchema(req.island, req.params)
      const island = req.island
      island.putSchema(schema, req.body, (err) => {
        if (err) {
          err.statusCode = 400
          return next(err)
        }
        island.getSchema(schema, (err, result) => {
          if (err) return next(err)
          res.send({ schema })
        })
      })
    },

    putSource (req, res, next) {
      const { key } = req.params
      const info = req.body
      req.island.putSource(key, info, (err) => {
        if (err) return next(err)
        return res.send({ msg: 'ok' })
      })
    },

    search (req, res, next) {
      const query = req.body
      const island = req.island
      // TODO: Enable loading of records.
      // TODO: Loading kills the server, that should not be.
      // There's a schema mismatch somewhere.
      island.query('search', query, { load: false }, (err, results) => {
        // console.log('Q', query, err, results)
        if (err) return next(err)
        res.send(results)
      })
      // Query can either be a string (tantivy query) or an object (toshi json query)
      // const resultStream = island.db.api.search.query(query)
      // replyStream(res, resultStream)
    },

    debug (req, res, next) {
      return res.end('not implemented')
    }
  }
}

function expandSchema (island, { schemans, schemaname }) {
  if (!schemans || !schemaname) return null
  if (schemans === '_') schemans = island.key.toString('hex')
  const schema = schemans + '/' + schemaname
  return schema
}

function replyStream (res, stream) {
  const results = []
  let error = false
  stream.on('data', data => results.push(data))
  stream.on('error', err => (error = err))
  stream.on('close', () => {
    if (error) res.status(422).send({ error })
  })
  stream.on('end', () => {
    res.send(results)
  })
}
