import { setFailed } from '@actions/core'
import { run } from './post.js'

run().catch((error) => setFailed(error.message))
