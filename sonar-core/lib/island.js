const pretty = require('pretty-hash')
const sub = require('subleveldown')
const debug = require('debug')('sonar-core:island')
const Nanoresource = require('nanoresource')

const { RESOURCE_SCHEMA } = require('./schemas.js')

const Database = require('kappa-record-db')
const Fs = require('./fs')

const searchView = require('../views/search')
const historyView = require('../views/history')

module.exports = class Island extends Nanoresource {
  constructor (key, opts) {
    super()
    const self = this

    this.opts = opts

    if (!Buffer.isBuffer(key)) key = Buffer.from(key, 'hex')

    debug('opening island %s (name %s, alias %s)', pretty(key), opts.name, opts.alias)

    this.corestore = opts.corestore

    this._subscriptions = {}
    this._level = {
      db: sub(opts.level, 'd'),
      fs: sub(opts.level, 'f')
    }

    this.key = key

    this.db = new Database({
      key,
      corestore: this.corestore,
      db: this._level.db,
      validate: false,
      name: opts.name,
      alias: opts.alias
    })

    this.fs = new Fs({
      corestore: this.corestore,
      db: this._level.fs,
      oninit (localkey, info) {
        self.db.putSource(localkey, {
          type: 'hyperdrive',
          alias: opts.alias
        }, (err) => {
          if (err) debug('error adding local hyperdrive as source', err)
        })
      },
      resolveAlias (alias, cb) {
        self.query('records', { schema: 'core/source' }, (err, records) => {
          if (err) return cb(err)
          const aliases = records
            .map(r => r.value)
            .filter(v => v.type === 'hyperdrive')
            .filter(v => v.alias === alias)

          if (aliases.length > 1) {
            // TODO: Support named aliases (like foo-1, foo-2)
            return cb(new Error('alias is ambigous, use keys'))
          }
          if (!aliases.length) {
            return cb(new Error('alias not found'))
          }

          cb(null, aliases[0].key)
        })
      }
    })

    if (opts.name) this.name = opts.name

    this.ready = this.open.bind(this)
  }

  _open (cb) {
    this.db.ready(() => {
      this.key = this.db.key
      this.discoveryKey = this.db.discoveryKey
      this._mountViews()
      this.fs.ready(() => {
        debug(
          'opened island %s (dkey %s, feeds %d)',
          pretty(this.db.key),
          pretty(this.db.discoveryKey),
          this.db._feeds.length
        )
        cb()
      })
    })
  }

  _mountViews () {
    if (this.opts.relations) {
      this.db.use('relations', this.opts.relations.createView(this))
    }
    if (this.opts.indexCatalog) {
      this.db.use('search', searchView, {
        indexCatalog: this.opts.indexCatalog
      })
    }
    this.db.use('history', historyView)
  }

  init (cb) {
    this.db.putSchema(RESOURCE_SCHEMA.name, RESOURCE_SCHEMA, cb)
  }

  replicate (isInitator, opts) {
    return this.corestore.replicate(isInitator, opts)
  }

  put (record, cb) {
    this.db.put(record, cb)
  }

  del (record, cb) {
    this.db.del(record, cb)
  }

  get (req, opts, cb) {
    this.db.query('records', req, opts, cb)
  }

  batch (batch, cb) {
    this.db.batch(batch, cb)
  }

  loadRecord (key, seq, cb) {
    this.db.loadRecord(key, seq, cb)
  }

  putSchema (name, schema, cb) {
    this.db.putSchema(name, schema, cb)
  }

  getSchemas (cb) {
    const schemas = this.db.getSchemas()
    if (cb) cb(null, schemas)
    else return schemas
  }

  getSchema (name, cb) {
    const schema = this.db.getSchema(name)
    if (cb) cb(schema ? null : new Error('Schema not found'), schema)
    else return schema
  }

  deleteSchema (name, cb) {
    const deleted = this.db.deleteSchema(name)
    if (cb) cb(deleted ? null : new Error('Schema with this name not found'), name)
    else console.log('Successfully deleted schema')
  }

  putSource (key, info, cb) {
    this.db.putSource(key, info, cb)
  }

  query (name, args, opts, cb) {
    return this.db.query(name, args, opts, cb)
  }

  drive (key, cb) {
    this.fs.get(key, cb)
  }

  localDrive (cb) {
    cb(null, this.fs.localwriter)
  }

  _close (cb) {
    this.fs.close(() => {
      this.db.sync(() => {
        this.db.close(() => {
          cb()
        })
      })
    })
  }

  // Return some info on the island synchronously.
  status (cb) {
    if (!this.opened) return { opened: false, name: this.name }
    let localKey, localDriveKey
    const localFeed = this.db.getDefaultWriter()
    if (localFeed) localKey = localFeed.key.toString('hex')
    const localDrive = this.fs.localwriter
    if (localDrive) localDriveKey = localDrive.key.toString('hex')

    const status = {
      name: this.name,
      opened: true,
      key: this.key.toString('hex'),
      localKey,
      localDrive: localDriveKey
    }

    let pending = 2
    this.db.status((err, dbStats) => {
      if (err) status.db = { error: err.message }
      else status.db = dbStats
      if (--pending === 0) cb(null, status)
    })
    this.fs.status((err, fsStats) => {
      if (err) status.fs = { error: err.message }
      else status.fs = fsStats
      if (--pending === 0) cb(null, status)
    })
  }

  createSubscription (name, opts = {}) {
    const subscription = this.db.indexer.createSubscription(name, opts)
    this._subscriptions[name] = subscription
    return subscription
  }

  pullSubscription (name, opts, cb) {
    if (!this._subscriptions[name]) {
      this.createSubscription(name, opts)
    }
    this._subscriptions[name].pull(opts, result => {
      cb(null, result)
    })
  }

  pullSubscriptionStream (name, opts) {
    if (opts.live === undefined) opts.live = true
    if (!this._subscriptions[name]) {
      this.createSubscription(name, opts)
    }
    return this._subscriptions[name].createPullStream(opts)
  }

  ackSubscription (name, cursor, cb) {
    if (!this._subscriptions[name]) return cb(new Error('Subscription does not exist'))
    this._subscriptions[name].setCursor(cursor, cb)
  }
}
