import { CfnOutput, Environment, Stack, StackProps, Stage, Tags } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import { Account, Accounts } from './accounts';
import { CodeGuruReviewCheck, CodeGuruReviewFilter } from './codeguru-review-check';
import { CodeBuildStep, CodePipeline, StageDeployment, Wave } from 'aws-cdk-lib/pipelines';
import { CodeCommitSource } from './codecommit-source';
//import { SoapUITest } from './soapui-test';
import * as codestar from 'aws-cdk-lib/aws-codestar';
//import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { TrivyScan } from './trivy-scan';
import { MavenBuild } from './maven-build';
//import { JMeterTest } from './jmeter-test';
//import { TerraformBuild } from './terraform-build';
import { DeploymentStack, DeploymentProps } from './terraform-deployment';

import {
  ManagedPolicy,
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

    const infraSourceOutput = new codepipeline.Artifact("InfraSrcOutput");
    const infraRepo = 'terraform-aws-opencbdc-tctl'
    const infraRepoOwner = process.env.repo_owner ? process.env.repo_owner : ""
    
    const codeSourceRepo = 'opencbdc-tctl'
    const codeRepoOwner = 'mit-dci'

    const adminRole : Role = createAdminRole(this)

    new codestar.CfnGitHubRepository(this, 'codeSource', {
      repositoryName: codeSourceRepo,
      repositoryOwner: codeRepoOwner,
      code: {
        s3: {
          bucket: infraSourceOutput.bucketName,
          key: '/',
        },
      }
    })
    
    new codestar.CfnGitHubRepository(this, 'infraSource', {
      repositoryName: infraRepo,
      repositoryOwner: infraRepoOwner,
      code: {
        s3: {
          bucket: infraSourceOutput.bucketName,
          key: '/',
        },
      }
    })

    const codeCommitSourceRepo = new CodeCommitSource(this, 'CodeSource', { name: `opencbdc-test-code-${this.account}`, codeRepoOwner: codeRepoOwner, codeSourceRepo: codeSourceRepo, branchName: 'trunk' });
    const codeCommitInfraRepo = new CodeCommitSource(this, 'InfraSource', { name: `opencbdc-test-infra-${this.account}`, codeRepoOwner: infraRepoOwner, codeSourceRepo: infraRepo, branchName: 'trunk' });
  
    /*
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
    */

    const cacheBucket = new Bucket(this, 'CacheBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    
    const codeGuruCodeSecurity = new CodeGuruReviewCheck('CodeGuruCodeSecurity', {
      source: codeCommitSourceRepo.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeSecurityFilter(),
    });
    
    const codeGuruInfraSecurity = new CodeGuruReviewCheck('CodeGuruInfraSecurity', {
      source: codeCommitInfraRepo.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeSecurityFilter(),
    });
    
    const codeGuruCodeQuality = new CodeGuruReviewCheck('CodeGuruCodeQuality', {
      source: codeCommitSourceRepo.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeQualityFilter(),
    });
    
    const codeGuruInfraQuality = new CodeGuruReviewCheck('CodeGuruInfraQuality', {
      source: codeCommitInfraRepo.codePipelineSource,
      reviewRequired: false,
      filter: CodeGuruReviewFilter.defaultCodeQualityFilter(),
    });
    
    const trivyCodeScan = new TrivyScan('TrivyCodeScan', {
      source: codeCommitSourceRepo.codePipelineSource,
      severity: ['CRITICAL', 'HIGH'],
      checks: ['vuln', 'config', 'secret'],
    });

    const buildAction = new MavenBuild('Build', {
      source: codeCommitSourceRepo.codePipelineSource,
      cacheBucket,
    });

    buildAction.addStepDependency(codeGuruCodeSecurity);
    buildAction.addStepDependency(codeGuruInfraSecurity);
    buildAction.addStepDependency(codeGuruCodeQuality);
    buildAction.addStepDependency(codeGuruInfraQuality);
    buildAction.addStepDependency(trivyCodeScan);

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
    
    const pipeline = new CodePipeline(this, "cdk-cbdcdeploy", {
      pipelineName: "cdk-cbdcdeploy",
      synth: synthAction,
      dockerEnabledForSynth: true,
      crossAccountKeys: true,
      publishAssetsInParallel: false,
    });
    
    new PipelineEnvironment(pipeline, Beta, {
      infraRepoCode: codeCommitInfraRepo.codePipelineSource,
      role: adminRole,
      infraRepoOwner: infraRepoOwner,
      infraRepoSource: infraRepo
    })

    /*
    new PipelineEnvironment(pipeline, Beta, (deployment, stage) => {
      stage.addPost(
        new JMeterTest('Performance Test', {
          source: codeCommitInfraRepo.codePipelineSource,
          endpoint: deployment.apiUrl,
          threads: 300,
          duration: 300,
          throughput: 6000,
          cacheBucket,
        }),
      );
    })
    */
    
    /*
    new PipelineEnvironment(pipeline, Beta, (deployment, stage) => {
      stage.addPost(
        new SoapUITest('E2E Test', {
          source: codeCommitInfraRepo.codePipelineSource,
          endpoint: deployment.apiUrl,
          cacheBucket,
        }),
      );
    });
    */
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
    props: DeploymentProps,
    stagePostProcessor?: PipelineEnvironmentStageProcessor,
    wavePostProcessor?: PipelineEnvironmentWaveProcessor,
  ) {
    if (!environment.account?.accountId) {
      throw new Error(`Missing accountId for environment '${environment.name}'. Do you need to update '.accounts.env'?`);
    }
    for (const [i, regions] of environment.waves.entries()) {
      const wave = pipeline.addWave(`${environment.name}-${i}`);
      for (const region of regions) {
        const deployment = new Deployment(pipeline, environment.name, props, {
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

/*
interface DeploymentProps {
  infraRepoCode: CodePipelineSource;
  role: Role;
  infraRepoOwner: string;
  infraRepoSource: string;
}
*/



class Deployment extends Stage {
  
  readonly apiUrl: CfnOutput;
  constructor(scope: Construct, environmentName: string, props: DeploymentProps, env?: Environment) {
    super(scope, `${environmentName}-${env!.region!}`, { env });

    const appName = this.node.tryGetContext('appName');
    
    const stack = new DeploymentStack(this, appName, props );
    this.apiUrl = stack.apiUrl;

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