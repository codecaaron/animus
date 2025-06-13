# GitHub Actions Workflow Updates for Syzygy

After registering the @syzygy scope, update these in your workflows:

## 1. Update publish-beta.yaml

```yaml
- name: Use NodeJS 20
  uses: actions/setup-node@v3
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_SECRET }}
  with:
    node-version: '20'
    registry-url: 'https://registry.npmjs.org'
    scope: 'syzygy'  # Changed from 'animus-ui'
```

## 2. Update publish-alpha.yaml

```yaml
- name: Use NodeJS 20
  uses: actions/setup-node@v3
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_SECRET }}
  with:
    node-version: '20'
    registry-url: 'https://registry.npmjs.org'
    scope: 'syzygy'  # Changed from 'animus-ui'
```

## 3. Ensure NPM Token Has Correct Permissions

Your NPM_SECRET must have publish permissions for the @syzygy scope. If using the same token:

1. The token needs to be from an account that's a member of the @syzygy org
2. Or create a new automation token specifically for @syzygy:
   ```bash
   npm token create --cidr=0.0.0.0/0 --read-only=false
   ```

## 4. First Publish After Rename

The first publish after the rename might need `--access public`:
```yaml
yarn lerna publish from-git --yes --no-verify-access --access public
```

This ensures scoped packages are published publicly.