import { /*CfnOutput,*/ Environment, Stack, StackProps, Stage, Tags } from 'aws-cdk-lib';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";

import { Account, Accounts } from './accounts';
import { CodeGuruReviewCheck, CodeGuruReviewFilter } from './codeguru-review-check';
import { CodeBuildStep, CodePipeline, CodePipelineSource, StageDeployment, Wave } from 'aws-cdk-lib/pipelines';
import * as sm from "aws-cdk-lib/aws-secretsmanager";
// import { JMeterTest } from './jmeter-test';

import { MavenBuild } from './maven-build';
import { SoapUITest } from './soapui-test';
import { TrivyScan } from './trivy-scan';

import * as codebuild from "aws-cdk-lib/aws-codebuild";

import {
  Effect, 
  ManagedPolicy, 
  PolicyStatement, 
  PolicyDocument, 
  Role, 
  ServicePrincipal,
  CompositePrincipal
} from "aws-cdk-lib/aws-iam";

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

    const githubToken = process.env.github_access_token ? process.env.github_access_token : ""

    const infraSourceOutput = new codepipeline.Artifact("InfraSrcOutput");
    const infraRepo = 'terraform-aws-opencbdc-tctl'
    const infraRepoOwner = process.env.repo_owner ? process.env.repo_owner : ""
    
    const codeSourceOutput = new codepipeline.Artifact("CodeSrcOutput");
    const codeSourceRepo = 'opencbdc-tctl'
    const codeRepoOwner = 'mit-dci'

    const adminRole : Role = createAdminRole(this)
    
    const secret = sm.Secret.fromSecretAttributes(this, "ImportedSecret", {
      secretCompleteArn:
        `arn:aws:secretsmanager:${process.env?.region}:${this.account}:secret:${githubToken}-${process.env.github_access_token_suffix}`
    });

    const infraSource = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: "GetGitHubTerraformSource",
      output: infraSourceOutput,
      owner: infraRepoOwner,
      branch: process.env.branch,
      repo: infraRepo,
      connectionArn: `arn:aws:codestar-connections:${process.env.region}:${this.account}:connection/${process.env.codestar_connectionid}`
    })
    
    const codeSource  = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: "GetGitHubCodeSource",
      output: codeSourceOutput,
      owner: codeRepoOwner,
      branch: process.env.branch,
      repo: codeSourceRepo,
      connectionArn: `arn:aws:codestar-connections:${process.env.region}:${this.account}:connection/${process.env.codestar_connectionid}`
    })

    const appName = this.node.tryGetContext('appName');
    // const source = new CodeCommitSource(this, 'Source', { repositoryName: appName });

    const cacheBucket = new Bucket(this, 'CacheBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    
    const terraformPlan = new codebuild.PipelineProject(
      this,
      "TerraformPlan",
      {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
          privileged: false,
          computeType: codebuild.ComputeType.MEDIUM
        },
        buildSpec: codebuild.BuildSpec.fromSourceFilename("plan-buildspec.yml"),
        role: adminRole,
        environmentVariables: {
          environment: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: 'dev'
          },
          s3_terraform: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform
          },
          lets_encrypt_email: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.lets_encrypt_email
          },
          base_domain: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.base_domain
          },
          hosted_zone_id: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.hosted_zone_id
          },
          s3_terraform_plan: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform_plan
          },
          s3_artifacts_builds: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_artifacts_builds
          },
          cert_arn: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.cert_arn
          },
          github_access_token: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token
          },
          access_token_suffix: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token_suffix
          },
          region: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.region
          },
          branch: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.branch
          },
          github_repo_owner: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: infraRepoOwner
          },
          github_repo: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: infraRepo
          },
          account_id: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: this.account
          },
        }
      }
    )
    
    const terraformApply = new codebuild.PipelineProject(
      this,
      "TerraformApply",
      {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
          privileged: false,
          computeType: codebuild.ComputeType.MEDIUM
        },
        buildSpec: codebuild.BuildSpec.fromSourceFilename("deploy-buildspec.yml"),
        role: adminRole,
        environmentVariables: {

          s3_terraform: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform
          },
          s3_terraform_plan: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform_plan
          },
          s3_artifacts_builds: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_artifacts_builds
          },
          account_id: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: this.account
          },
          github_access_token: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token
          },
          access_token_suffix: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token_suffix
          },
          region: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.region
          },
        }
      }
    )
    
    const pipeline = new codepipeline.Pipeline(this, "cdk-cbdcdeploy", {
      pipelineName: "cdk-cbdcdeploy",
      crossAccountKeys: true,
      role: adminRole,
    });

    pipeline.addStage({
      stageName: "getSources",
      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: "GetGitHubTerraformSource",
          output: infraSourceOutput,
          owner: infraRepoOwner,
          branch: process.env.branch,
          repo: infraRepo,
          connectionArn: `arn:aws:codestar-connections:${process.env.region}:${this.account}:connection/${process.env.codestar_connectionid}`
        }),
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: "GetGitHubTerraformSource",
          output: codeSourceOutput,
          owner: codeRepoOwner,
          branch: process.env.branch,
          repo: codeSourceRepo,
          connectionArn: `arn:aws:codestar-connections:${process.env.region}:${this.account}:connection/${process.env.codestar_connectionid}`
        })
      ]
    })

    /*
    const codeGuruSecurity = new CodeGuruReviewCheck('CodeGuruSecurity', {
      source: codeSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeSecurityFilter(),
    });
    */
    
    /*
    const codeGuruQuality = new CodeGuruReviewCheck('CodeGuruQuality', {
      source: source.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeQualityFilter(),
    });
    */
    
    /*
    const trivyScan = new TrivyScan('TrivyScan', {
      source: source.codePipelineSource,
      severity: ['CRITICAL', 'HIGH'],
      checks: ['vuln', 'config', 'secret'],
    });
    */

    
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

const createAdminRole = (context: Stack): Role => {
  return new Role(context, 'CustomAdminRole', {
    assumedBy: new CompositePrincipal(
      new ServicePrincipal('codebuild.amazonaws.com'),  
      new ServicePrincipal('codepipeline.amazonaws.com')
    ),
    description: 'Overly permissive demo admin role for deploying Terraform scripts',
    managedPolicies: [
      ManagedPolicy.fromManagedPolicyArn(context, 'AdminPolicy', 'arn:aws:iam::aws:policy/AdministratorAccess')
    ]
  });
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