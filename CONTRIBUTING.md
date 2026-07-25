# Contributing to SaDeL

Thank you for your interest in contributing to SaDeL! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and professional
- No harassment or discrimination
- Focus on the code, not the person

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork>`
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Set up development environment: `npm install && npm run docker:up`

## Development Workflow

### Before Starting

```bash
npm install
npm run lint
npm run type-check
```

### Making Changes

1. Create a feature branch from `develop`
2. Make your changes following the code style
3. Write tests for new functionality
4. Update documentation if needed

### Code Style

- **TypeScript**: Strict mode enabled, no `any` types
- **Formatting**: Use Prettier (automatic with pre-commit)
- **Linting**: Follow ESLint rules
- **Naming**: camelCase for variables/functions, PascalCase for classes/types

### Commit Messages

Follow conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
style: formatting changes
refactor: code restructuring
test: add/update tests
chore: maintenance tasks
```

Example:
```
feat(orders): add real-time order notifications

- Implement Socket.io events for order status
- Add notification service
- Update order schema
```

### Testing

```bash
npm run test
npm run test:watch
npm run test:coverage
```

- Write tests for new features
- Maintain >80% code coverage
- Update tests when modifying existing code

### Linting & Formatting

```bash
npm run lint
npm run lint -- --fix
npm run format
```

## Pull Request Process

1. Ensure all tests pass: `npm run test`
2. Ensure code is formatted: `npm run format`
3. Ensure no linting errors: `npm run lint`
4. Ensure types are correct: `npm run type-check`
5. Update docs if necessary
6. Submit PR with descriptive title and description

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #(issue number)

## Testing
How to test these changes

## Checklist
- [ ] Code follows style guidelines
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes
```

## Branch Naming

- `feature/description`: New features
- `bugfix/description`: Bug fixes
- `docs/description`: Documentation
- `refactor/description`: Code refactoring

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag: `git tag v1.0.0`
4. Build and push Docker images
5. Deploy to production

## Reporting Issues

### Bug Reports

Include:
- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots/logs if applicable
- Environment (OS, Node version, etc.)

### Feature Requests

Include:
- Use case/motivation
- Proposed solution
- Alternatives considered
- Additional context

## Documentation

- Keep README.md updated
- Add JSDoc comments to functions
- Update API documentation
- Add examples for complex features

## Questions?

- Open a discussion on GitHub
- Check existing issues/discussions
- Read architecture docs

## License

By contributing, you agree that your contributions will be licensed under the project's license.

---

Thank you for contributing to SaDeL! 🚀
