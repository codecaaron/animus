// The failure is a top-level throw rather than a parse error so repo linters
// and formatters still accept this fixture.
throw new Error('broken-system fixture: deliberate load failure');
