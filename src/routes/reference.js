const express = require('express');
const cars = require('../data/cars');
const pids = require('../data/pids');
const { all: allDtcs } = require('../lib/dtc');
const inspectionItems = require('../data/inspection-items');
const { lookup } = require('../lib/dtc');

const router = express.Router();

router.get('/cars', (_req, res) => res.json(cars));
router.get('/pids', (_req, res) => res.json(pids));
router.get('/dtcs', (_req, res) => res.json(allDtcs()));
router.get('/inspection-items', (_req, res) => res.json(inspectionItems));
router.get('/dtc/:code', (req, res) => res.json(lookup(req.params.code)));

module.exports = router;
