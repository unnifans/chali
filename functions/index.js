const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { onVoteUpdate } = require('./src/onVoteUpdate');

exports.onVoteUpdate = onVoteUpdate;
