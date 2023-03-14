import { /*CfnOutput,*/ Environment, Stack, StackProps, Stage, Tags } from 'aws-cdk-lib';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";

import { Account, Accounts } from './accounts';
import { CodeGuruReviewCheck, CodeGuruReviewFilter } from './codeguru-review-check';
import { CodeBuildStep, CodePipeline, CodePipelineSource, StageDeployment, Wave } from 'aws-cdk-lib/pipelines';
// import { JMeterTest } from './jmeter-test';

import { MavenBuild } from './maven-build';
import { SoapUITest } from './soapui-test';
import { TrivyScan } from './trivy-scan';


export const accounts = Accounts.load();

// BETA environment is 1 wave with 1 region
export const Beta: EnvironmentConfig = {
  name: 'Beta',
  account: accounts.beta,
  waves: [
    ['us-west-1'],
  ],
};

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const branch = 'trunk';
    const infraSourceOutput = new codepipeline.Artifact("SrcOutput");
    const infraRepo = 'terraform-aws-opencbdc-tctl'
    const infraRepoOwner = process.env.repo_owner ? process.env.repo_owner : ""
    const codeSourceRepo = 'opencbdc-tctl'
    const codeRepoOwner = 'mit-dci'

    const infraSource = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: "GetGitHubTerraformSource",
      output: infraSourceOutput,
      owner: infraRepoOwner,
      branch: process.env.branch,
      repo: infraRepo,
      connectionArn: `arn:aws:codestar-connections:${process.env.region}:${this.account}:connection/${process.env.codestar_connectionid}`
    })

    const appName = this.node.tryGetContext('appName');
    // const source = new CodeCommitSource(this, 'Source', { repositoryName: appName });

    const cacheBucket = new Bucket(this, 'CacheBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const codeGuruSecurity = new CodeGuruReviewCheck('CodeGuruSecurity', {
      source: source.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeSecurityFilter(),
    });
    const codeGuruQuality = new CodeGuruReviewCheck('CodeGuruQuality', {
      source: source.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeQualityFilter(),
    });
    const trivyScan = new TrivyScan('TrivyScan', {
      source: source.codePipelineSource,
      severity: ['CRITICAL', 'HIGH'],
      checks: ['vuln', 'config', 'secret'],
    });

    const buildAction = new MavenBuild('Build', {
      source: source.codePipelineSource,
      cacheBucket,
    });

    buildAction.addStepDependency(codeGuruQuality);
    buildAction.addStepDependency(codeGuruSecurity);
    buildAction.addStepDependency(trivyScan);

    const synthAction = new CodeBuildStep('Synth', {
      input: buildAction,
      partialBuildSpec: BuildSpec.fromObject({
        phases: {
          install: {
            'runtime-versions': {
              nodejs: 14,
            },
          },
          build: {
            commands: ['yarn install --frozen-lockfile', 'npm run build', 'npx cdk synth'],
          },
        },
        version: '0.2',
      }),
      commands: [],
    });

    const pipeline = new CodePipeline(this, appName, {
      pipelineName: appName,
      synth: synthAction,
      dockerEnabledForSynth: true,
      crossAccountKeys: true,
      publishAssetsInParallel: false,
    });

    new PipelineEnvironment(pipeline, Beta, (deployment, stage) => {
      stage.addPost(
        new SoapUITest('E2E Test', {
          source: source.codePipelineSource,
          endpoint: deployment.apiUrl,
          cacheBucket,
        }),
      );
    });
  }
}

type PipelineEnvironmentStageProcessor = (deployment: Deployment, stage: StageDeployment) => void;
type PipelineEnvironmentWaveProcessor = (wave: Wave) => void;

class PipelineEnvironment {
  constructor(
    pipeline: CodePipeline,
    environment: EnvironmentConfig,
    stagePostProcessor?: PipelineEnvironmentStageProcessor,
    wavePostProcessor?: PipelineEnvironmentWaveProcessor) {
    if (!environment.account?.accountId) {
      throw new Error(`Missing accountId for environment '${environment.name}'. Do you need to update '.accounts.env'?`);
    }
    for (const [i, regions] of environment.waves.entries()) {
      const wave = pipeline.addWave(`${environment.name}-${i}`);
      for (const region of regions) {
        const deployment = new Deployment(pipeline, environment.name, {
          account: environment.account!.accountId!,
          region,
        });
        const stage = wave.addStage(deployment);
        if (stagePostProcessor) {
          stagePostProcessor(deployment, stage);
        }
      }
      if (wavePostProcessor) {
        wavePostProcessor(wave);
      }
    }
  }
}

class Deployment extends Stage {

  constructor(scope: Construct, environmentName: string, env?: Environment) {
    super(scope, `${environmentName}-${env!.region!}`, { env });
    const appName = this.node.tryGetContext('appName');
    
    Tags.of(this).add('Environment', environmentName);
    Tags.of(this).add('Application', appName);
  }
}

type Region = string;
type WaveRegions = Region[]
interface EnvironmentConfig {
  name: string;
  account?: Account;
  waves: WaveRegions[];
}