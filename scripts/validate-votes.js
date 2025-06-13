#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

// Partner signature patterns
const SIGNATURES = {
  claude: /---CLAUDE-SIGNATURE-START---[\s\S]+?---CLAUDE-SIGNATURE-END---/,
  gemini: /===GEMINI-SIGNATURE-BLOCK===[\s\S]+?===END-SIGNATURE-BLOCK===/,
  openai: /<<<OPENAI-GOVERNANCE-SIGNATURE>>>[\s\S]+?<<<END-GOVERNANCE-SIGNATURE>>>/,
  aaron: /### HUMAN SIGNATURE ###[\s\S]+?### END SIGNATURE ###/
};

function validateVote(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const partner = fileName.replace('.vote.md', '');

  console.log(`\nValidating vote from ${partner}...`);

  // Check file naming
  if (!fileName.endsWith('.vote.md')) {
    throw new Error(`Invalid file name: ${fileName}. Must end with .vote.md`);
  }

  // Check signature
  if (!SIGNATURES[partner]) {
    throw new Error(`Unknown partner: ${partner}`);
  }

  if (!SIGNATURES[partner].test(content)) {
    throw new Error(`Invalid or missing signature for ${partner}`);
  }

  // Extract vote
  const voteMatch = content.match(/\*\*Vote\*\*:\s*([+-]1|ABSTAIN)/);
  if (!voteMatch) {
    throw new Error('Invalid vote format. Must specify **Vote**: +1, -1, or ABSTAIN');
  }

  const vote = voteMatch[1];
  console.log(`✓ Valid vote from ${partner}: ${vote}`);

  return { partner, vote, valid: true };
}

function tallyVotes(proposalDir) {
  const votesDir = path.join(proposalDir, 'votes');
  const votes = {};
  const requiredPartners = ['claude', 'gemini', 'openai', 'aaron'];

  // Check if votes directory exists
  if (!fs.existsSync(votesDir)) {
    console.error('No votes directory found');
    return;
  }

  // Validate each vote file
  const voteFiles = fs.readdirSync(votesDir).filter(f => f.endsWith('.vote.md'));

  for (const file of voteFiles) {
    try {
      const result = validateVote(path.join(votesDir, file));
      votes[result.partner] = result.vote;
    } catch (error) {
      console.error(`Error validating ${file}: ${error.message}`);
    }
  }

  // Check for missing votes
  console.log('\n--- Vote Tally ---');
  let approved = true;

  for (const partner of requiredPartners) {
    if (votes[partner]) {
      console.log(`${partner}: ${votes[partner]}`);
      if (votes[partner] === '-1') {
        approved = false;
      }
    } else {
      console.log(`${partner}: NO VOTE YET`);
      approved = false;
    }
  }

  // Final result
  console.log('\n--- Result ---');
  if (Object.keys(votes).length === requiredPartners.length && approved) {
    console.log('✅ APPROVED - Unanimous consent achieved');
  } else if (Object.values(votes).includes('-1')) {
    console.log('❌ REJECTED - One or more partners voted against');
  } else {
    console.log('⏳ PENDING - Waiting for all votes');
  }
}

// Main execution
const proposalPath = process.argv[2];
if (!proposalPath) {
  console.error('Usage: node validate-votes.js <proposal-directory>');
  console.error('Example: node validate-votes.js votes/active/issue-60-rename-to-syzygy');
  process.exit(1);
}

tallyVotes(proposalPath);
