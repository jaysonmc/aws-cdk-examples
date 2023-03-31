import { App, Tags } from 'aws-cdk-lib';

const appName = 'open-cbdc-throughput-test';
const app = new App({ context: { appName } });
const environmentName = app.node.tryGetContext('environmentName');

Tags.of(app).add('Application', appName);
if (environmentName) {
  Tags.of(app).add('Environment', environmentName);
}

app.synth();