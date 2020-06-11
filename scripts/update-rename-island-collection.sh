#!/bin/sh

# this script auto-updates the "renames" branch on top of development.
#
# after running use 
#   git push -f origin renames` 
# to force push the updated branch
#
# needs amber (https://github.com/dalance/amber)

git checkout master
git branch -D renames
git checkout -b renames

# rename island to collection
ambr --no-interactive island collection .
ambr --no-interactive Island Collection .
git checkout -f HEAD -- scripts
git mv sonar-cli/bin/island.js sonar-cli/bin/collection.js
git mv sonar-core/lib/island.js sonar-core/lib/collection.js
git mv sonar-server/commands/island.js sonar-server/commands/collection.js
git mv sonar-server/commands/island.toml sonar-server/commands/collection.toml
git mv sonar-ui/src/components/Island.js sonar-ui/src/components/Collection.js
git mv sonar-ui/src/pages/Islands.js sonar-ui/src/pages/Collections.js
git add -u .
git commit -m "rename island to collection"
