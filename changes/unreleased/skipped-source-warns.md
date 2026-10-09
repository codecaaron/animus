**A skipped source no longer fails a build over an option nothing renders.**
While ingestion skips a source (an MDX file that does not compile, a missing
`@mdx-js/mdx` peer, an unreadable file), nothing is pruned, because the
skipped file may render any option. That used to run the analysis as a
development build, so an error from an option that ships only because
pruning is off, such as a failing transform on a variant option no render
uses, failed a non-strict production build. Such an error is now a warning
that names the skipped file. Errors from options something renders still
fail, strict builds still fail on the skip itself, and development builds
behave as before.
